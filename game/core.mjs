import {CHARACTERS,HARNESSES,WEAPONS,POWERUPS,RULES,resolveLoadout} from './data.mjs';
import {MAPS,getMap,pickupWeapon} from './maps.mjs';
import {normalizeConfig,DIFFICULTIES,GAME_MODES,spawnInventory,modeWeapon,modeRule,teamMode} from './config.mjs';
import {harnessAbility,harnessPassive,harnessVehicle,harnessWeaponHandling} from './harness-profiles.mjs';
import {turnToward} from './character-anim.mjs';
import {resolveGear} from './progression.mjs';
import {resolveAttachments,applyAttachmentsToWeapon} from './attachments.mjs';
import {terrainRayHit,terrainSupportAt,terrainWallSegments} from './terrain.mjs';
import {createVehicle,GUNTRUCK,respawnVehicle,stepVehicle,stepVehicleWeapon,vehicleCanEnter,vehicleMuzzles,vehicleSeatFor,vehicleSeatPosition,vehicleMounted,takeVehicleSeat,leaveVehicleSeat,vehicleSeatOpen} from './vehicles.mjs';
import {objectiveTemplate} from './mode-data.mjs';
import {deathPlan} from './deaths.mjs';
import {payloadPosition,payloadProgress,payloadTemplate} from './payload.mjs';
import {initializeRace,stepRace,raceStandings,raceSnapshot} from './race.mjs';
import {initializeSoccer,stepSoccer,soccerStandings,soccerSnapshot} from './soccer.mjs';
import {initializeSinglePlayer,updateSinglePlayer,singlePlayerSnapshot} from './singleplayer.mjs';
import {rankLeaders} from './outcome.mjs';
import * as bots from './bots.mjs';
import * as objectives from './objectives.mjs';
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const v=(x=0,y=0,z=0)=>({x,y,z});
const add=(a,b,s=1)=>v(a.x+b.x*s,a.y+b.y*s,a.z+b.z*s);
const norm=a=>{const l=Math.hypot(a.x,a.y,a.z)||1;return v(a.x/l,a.y/l,a.z/l)};
const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);
export const eye=a=>v(a.x,a.y+(Number.isFinite(a.eyeHeight)?a.eyeHeight:1.45),a.z);
export const aim=(yaw,pitch=0)=>v(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
export const BLOCKS=MAPS[0].blocks;
const boundsOf=arena=>arena.bounds||{minX:-13.55,maxX:13.55,minZ:-13.55,maxZ:13.55};
const arenaDiagonal=arena=>{const b=boundsOf(arena);return Math.hypot(b.maxX-b.minX,b.maxZ-b.minZ);};
const BOT_SCAN={easy:{base:33,scale:.045,cap:44},normal:{base:36,scale:.06,cap:54},hard:{base:38,scale:.07,cap:58},nightmare:{base:39,scale:.075,cap:60}};
const botScanRange=(difficulty,arena)=>{const scan=BOT_SCAN[difficulty?.id]||BOT_SCAN.normal;return Math.min(scan.cap,scan.base+arenaDiagonal(arena)*scan.scale);};
const teamPoints=(value, fallback)=>{const out={0:[],1:[]};for(const key of [0,1,'red','blue']){const team=key===0||key==='red'?0:1;const points=value?.[key];if(Array.isArray(points))out[team]=points.map(p=>Array.isArray(p)?p:[p.x,p.z]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));}return {0:out[0].length?out[0]:fallback[0],1:out[1].length?out[1]:fallback[1]};};
const flagPoints=(value,fallback)=>{const out={0:fallback[0],1:fallback[1]};for(const key of [0,1,'red','blue']){const team=key===0||key==='red'?0:1,point=value?.[key];if(Array.isArray(point)&&Number.isFinite(point[0])&&Number.isFinite(point[1]))out[team]=point;else if(point&&Number.isFinite(point.x)&&Number.isFinite(point.z))out[team]=[point.x,point.z];}return out;};
const linkFor=(arena,id)=>{const link=(arena.jumpLinks||[]).find(item=>(item.traversal||item.traversalId||item.traversalID)===id);return link?.target;};
const resolvePoint=value=>{if(!value)return null;if(Array.isArray(value))return {x:+value[0]||0,y:value.length>2&&Number.isFinite(+value[1])?+value[1]:null,z:+value[value.length>2?2:1]||0};return {x:+value.x||0,y:Number.isFinite(value.y)?value.y:null,z:+value.z||0};};
const traversalSource=(arena,name)=>(arena.traversal||arena.traversalMetadata)?.[name]||arena[name]||[];
const traversalCache=new WeakMap();
export function traversalTables(arena){
 const cached=traversalCache.get(arena);
 if(cached)return cached;
 const trampolines=[...traversalSource(arena,'trampolines'),...traversalSource(arena,'jumpPads'),...traversalSource(arena,'pads')].map((p,i)=>({...p,type:'trampoline',id:p.id??`t${i}`})),boosts=traversalSource(arena,'boostLaunchers').concat(traversalSource(arena,'launchers')).map((p,i)=>({...p,type:'boost',id:p.id??`b${i}`,target:p.target||linkFor(arena,p.id??`b${i}`)})),pads=[...trampolines,...boosts],teleporters=traversalSource(arena,'teleporters').map((p,i)=>({...p,id:p.id??`tp${i}`,to:p.target??p.to})),ziplines=traversalSource(arena,'ziplines').map((p,i)=>({...p,id:p.id??`zip${i}`,from:p.from??p.a,to:p.to??p.b}));
 const tables={pads,teleporters,ziplines};
 traversalCache.set(arena,tables);
 return tables;
}
 const surfacesOf=arena=>arena.platforms||arena.surfaces||[];
 const surfaceY=surface=>surface.y??surface.topY??0;
  export function floorAt(x,z,arena=MAPS[0]){if(arena.terrain){return terrainSupportAt(x,z,arena.terrain,arena.terrain.maxSlope??.9)?.y??null;}const surfaces=surfacesOf(arena);if(surfaces.length){let floor=null;for(const surface of surfaces)if(Math.abs(x-surface.x)<=surface.w/2&&Math.abs(z-surface.z)<=surface.d/2)floor=floor===null?surfaceY(surface):Math.max(floor,surfaceY(surface));return floor;}if(!arena.raised)return 0;let floor=0,solid=arena.blocks.some(b=>b.kind!=='deck'&&Math.abs(x-b.x)<=b.w/2&&Math.abs(z-b.z)<=b.d/2);for(const b of arena.blocks)if(b.kind==='deck'&&Math.abs(x-b.x)<=b.w/2&&Math.abs(z-b.z)<=b.d/2)floor=Math.max(floor,b.h);if(!arena.bounds&&!solid&&z<=-9)floor=Math.max(floor,3.8);else if(!arena.bounds&&!solid&&Math.abs(x)>8.2&&Math.abs(x)<14&&z<3)floor=Math.max(floor,(3-z)/12*3.8);return floor;}
  const supportAt=(x,z,arena)=>{let y=floorAt(x,z,arena);if(y===null)return null;for(const b of arena.blocks)if(b.kind!=='deck'&&Math.abs(x-b.x)<=b.w/2+RULES.radius&&Math.abs(z-b.z)<=b.d/2+RULES.radius)y=Math.max(y,b.h);return y;};
  const segmentDistance=(x,z,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;if(length<=1e-9)return Math.hypot(x-a.x,z-a.z);const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/length,0,1);return Math.hypot(x-(a.x+dx*t),z-(a.z+dz*t));};
  const terrainObstructed=(x,y,z,r,arena)=>arena.terrain?.walls?.length>0&&terrainWallSegments(arena.terrain).some(({a,b})=>y<Math.max(a.y,b.y)-1e-6&&y+RULES.height>Math.min(a.y,b.y)+1e-6&&segmentDistance(x,z,a,b)<r);
 export function obstructed(x,y,z,r=RULES.radius,arena=MAPS[0]){return arena.blocks.some(b=>Math.abs(x-b.x)<b.w/2+r&&Math.abs(z-b.z)<b.d/2+r&&y<b.h-1e-6&&y+RULES.height>0)||terrainObstructed(x,y,z,r,arena);}
export const MOVE={friction:6,stopSpeed:2,groundAccel:10,airAccel:3.5,airCap:1.6,sprint:1.375,crouch:.4,slideBoost:9.6,slideMin:.35,slideFriction:2.5,slideCooldown:.5,terminal:2.2,eyeStanding:1.45,eyeCrouch:.95,baseHeight:1.8};
// Point-blank melee: a short forward arc, no ammo, brief cooldown. Gives every
// loadout an answer inside its own face and a reason to finish hurt targets.
export const MELEE={range:2.4,damage:45,cooldown:.6,arc:.2};
const canStand=(x,y,z,r,arena)=>!arena.blocks.some(b=>Math.abs(x-b.x)<b.w/2+r&&Math.abs(z-b.z)<b.d/2+r&&y<b.h-1e-6&&b.h<y+MOVE.baseHeight);
const accelerate=(a,ix,iz,wishSpeed,accel,dt)=>{const add=wishSpeed-(a.vx*ix+a.vz*iz);if(add<=0)return;const amount=Math.min(accel*dt*wishSpeed,add);a.vx+=ix*amount;a.vz+=iz*amount;};
export const SELF_BLAST_MARGIN=1.15;
// Linear damage falloff for hitscan weapons: full damage inside `start`, tapering
// to `min` at `end` and beyond. Weapons without falloff always deal full damage.
export function damageFalloff(weapon,distance){const f=weapon?.falloff;if(!f||!Number.isFinite(distance))return 1;const start=Number(f.start)||0,end=Number(f.end),min=Number.isFinite(f.min)?f.min:1;if(distance<=start)return 1;if(!(end>start))return min;const t=Math.min(1,(distance-start)/(end-start));return 1+(min-1)*t;}
export function blastUnsafe(weapon,distance){const radius=Number(weapon?.radius),splash=Number(weapon?.splash),d=Number(distance);if(!(radius>0)||!(splash>0)||!Number.isFinite(d))return false;return d<radius*SELF_BLAST_MARGIN;}
export function moveActor(a,input,dt,arena=MAPS[0],config={speed:1,gravity:1}){
 // Recover corrected/older embedded state without lifting actors through tall solids.
 for(const b of arena.blocks)if(Math.abs(a.x-b.x)<b.w/2+RULES.radius&&Math.abs(a.z-b.z)<b.d/2+RULES.radius&&a.y<b.h-1e-6){
  const candidates=[{x:b.x-b.w/2-RULES.radius-1e-6,y:a.y,z:a.z},{x:b.x+b.w/2+RULES.radius+1e-6,y:a.y,z:a.z},{x:a.x,y:a.y,z:b.z-b.d/2-RULES.radius-1e-6},{x:a.x,y:a.y,z:b.z+b.d/2+RULES.radius+1e-6}];
  if(b.h-a.y<=.25)candidates.push({x:a.x,y:b.h,z:a.z});
    const bounds=boundsOf(arena);const p=candidates.filter(p=>{const floor=floorAt(p.x,p.z,arena);return p.x>=bounds.minX&&p.x<=bounds.maxX&&p.z>=bounds.minZ&&p.z<=bounds.maxZ&&floor!==null&&floor<=p.y+1e-6&&!obstructed(p.x,p.y,p.z,RULES.radius,arena);}).sort((p,q)=>dist(a,p)-dist(a,q))[0];
  if(p){if(p.x!==a.x)a.vx=0;if(p.z!==a.z)a.vz=0;if(p.y!==a.y)a.vy=0;Object.assign(a,p);}
 }
 if(a.zipRide){const ride=a.zipRide;ride.t+=dt;const u=clamp(ride.t/ride.duration,0,1);a.x=ride.from.x+(ride.to.x-ride.from.x)*u;a.y=ride.from.y+(ride.to.y-ride.from.y)*u;a.z=ride.from.z+(ride.to.z-ride.from.z)*u;a.vx=a.vy=a.vz=0;a.grounded=false;if(u>=1){a.zipRide=null;a.grounded=true;a.lastValid={x:a.x,y:a.y,z:a.z};}const railBounds=boundsOf(arena);a.x=clamp(a.x,railBounds.minX,railBounds.maxX);a.z=clamp(a.z,railBounds.minZ,railBounds.maxZ);return;}
 const speed=(a.moveSpeed??CHARACTERS.find(c=>c.id===a.character)?.stats.speed??RULES.speed)*config.speed*(a.harnessSpeedMultiplier||1)*(a.speedMultiplier||1)*(a.active>0&&a.harness==='hermes'?(a.activeSpeedMultiplier||1.6):1)*(a.slow>0?(a.slowMultiplier??.55):1)*(a.gearSpeed||1);
 const len=Math.hypot(input.x||0,input.z||0),ix=len?(input.x||0)/len:0,iz=len?(input.z||0)/len:0;
 // Crouch is sticky while there is no headroom to stand.
 let crouching=input.crouch===true;
 if(!crouching&&a.crouching&&!canStand(a.x,a.y,a.z,RULES.radius,arena))crouching=true;
 const sprint=input.sprint===true&&a.grounded&&!crouching&&len>0,ads=input.ads===true&&!sprint;
 const maxSpeed=speed*(sprint?MOVE.sprint:1)*(crouching?MOVE.crouch:1)*(ads?.9:1),wishSpeed=maxSpeed*Math.min(1,len);
 // Sprint + crouch converts into a slide that preserves horizontal momentum.
 let horizontal=Math.hypot(a.vx,a.vz);
 if(crouching&&a.grounded&&!a.sliding&&(a.slideCooldown||0)<=0&&(input.sprint===true||a.sprinting)&&horizontal>6){
  a.sliding=true;a.slideTimer=MOVE.slideMin;
  if(horizontal>1e-4&&horizontal<MOVE.slideBoost){const burst=MOVE.slideBoost/horizontal;a.vx*=burst;a.vz*=burst;}
  else if(horizontal<=1e-4){a.vx=-Math.sin(a.yaw||0)*MOVE.slideBoost;a.vz=-Math.cos(a.yaw||0)*MOVE.slideBoost;}
  horizontal=Math.hypot(a.vx,a.vz);
 }
 a.crouching=crouching;a.sprinting=sprint;a.ads=ads;a.eyeHeight=crouching||a.sliding?MOVE.eyeCrouch:MOVE.eyeStanding;a.baseHeight=MOVE.baseHeight;
 a.sliding=a.sliding===true;a.slideTimer=Math.max(0,(a.slideTimer||0)-dt);a.slideCooldown=Math.max(0,(a.slideCooldown||0)-dt);
 if(a.grounded){
  a.coyote=.1;
  // A held or buffered hop landing this frame skips ground friction so repeated
  // hops keep their speed instead of bleeding it on every landing.
  const hopNow=(input.jump===true||a.jumpBuffer>0)&&a.coyote>0;
  if(!hopNow){const h=Math.hypot(a.vx,a.vz),friction=a.sliding?MOVE.slideFriction:MOVE.friction,control=Math.max(h,MOVE.stopSpeed),drop=control*friction*dt;if(h>1e-9){const scale=Math.max(0,h-drop)/h;a.vx*=scale;a.vz*=scale;}}
  if(ix||iz)accelerate(a,ix,iz,wishSpeed,a.sliding?MOVE.groundAccel*.4:MOVE.groundAccel,dt);
 }else{
  a.coyote=Math.max(0,a.coyote-dt);
  if(ix||iz){
   // Quake-style air acceleration: the add cap stays low so a straight hold
   // preserves speed while strafing turns it into gains. Coasting keeps momentum.
   const before=Math.hypot(a.vx,a.vz),projection=a.vx*ix+a.vz*iz,add=Math.min(wishSpeed,MOVE.airCap)-projection;
   if(add>0){const amount=Math.min(MOVE.airAccel*dt*wishSpeed,add);a.vx+=ix*amount;a.vz+=iz*amount;}
   const terminal=Math.max(maxSpeed*MOVE.terminal,before),next=Math.hypot(a.vx,a.vz);
   if(next>terminal&&next>1e-9){const s=terminal/next;a.vx*=s;a.vz*=s;}
  }
 }
 let jumpTriggered=false;
 if(a.grounded){a.jumpHeld=false;a.jumpCutArmed=false;}
 a.jumpBuffer=input.jump?.12:Math.max(0,a.jumpBuffer-dt);
 if(a.jumpBuffer>0&&a.coyote>0){a.vy=RULES.jump;a.grounded=false;a.jumpBuffer=0;a.coyote=0;a.jumpHeld=true;a.jumpCutArmed=false;jumpTriggered=true;a.sliding=false;a.slideTimer=0;a.slideCooldown=Math.max(a.slideCooldown||0,MOVE.slideCooldown);}
 if(a.jumpHeld&&input.jump===true&&!jumpTriggered)a.jumpCutArmed=true;
 // Variable jump: releasing a held button early trims upward velocity. A single-frame tap stays a full hop.
 if(a.jumpHeld&&input.jump!==true&&a.vy>0){if(a.jumpCutArmed)a.vy*=.45;a.jumpHeld=false;a.jumpCutArmed=false;}
 const apex=!a.traversalFlight&&config.gravity>=1&&Math.abs(a.vy)<2.5,gravity=RULES.gravity*config.gravity*(apex?.6:1);
 // Small axis moves preserve sliding and prevent fast knockback tunneling.
 const steps=Math.max(1,Math.ceil(Math.max(Math.abs(a.vx*dt),Math.abs(a.vz*dt),Math.abs(a.vy*dt)+gravity*dt*dt)/.18)),step=dt/steps;
 for(let i=0;i<steps;i++){
 for(const axis of ['x','z']){
  const value=a[axis]+a[axis==='x'?'vx':'vz']*step;
  const nx=axis==='x'?value:a.x,nz=axis==='z'?value:a.z;
    const f=floorAt(nx,nz,arena);let top=null;for(const b of arena.blocks)if(b.kind!=='deck'&&Math.abs(nx-b.x)<b.w/2+RULES.radius&&Math.abs(nz-b.z)<b.d/2+RULES.radius&&(top===null||b.h>top))top=b.h;let ny=f!==null&&Math.abs(f-a.y)<.25&&a.vy<=0&&a.grounded?f:a.y;if(top!==null&&a.grounded&&a.vy<=0&&a.y>=top-1e-6&&a.y-top<.35)ny=Math.max(ny,top);
  // The ramp meets the deck before the actor's center crosses the terrain seam.
  if(a.grounded&&a.vy<=0)for(const b of arena.blocks)if(b.kind==='deck'&&Math.abs(nx-b.x)<b.w/2+RULES.radius&&Math.abs(nz-b.z)<b.d/2+RULES.radius&&Math.abs(b.h-a.y)<.25)ny=Math.max(ny,b.h);
    if((a.traversalFlight&&a.traversalTarget||!obstructed(nx,ny,nz,RULES.radius,arena))&&(f===null||f-a.y<.3)){a[axis]=value;a.y=ny;}else a[axis==='x'?'vx':'vz']=0;
 }
  const hb=boundsOf(arena);a.x=clamp(a.x,hb.minX,hb.maxX);a.z=clamp(a.z,hb.minZ,hb.maxZ);
  a.vy-=gravity*step;const nextY=a.y+a.vy*step;let f=floorAt(a.x,a.z,arena);
  // A solid top is a landing surface only when the feet cross it while falling.
  for(const b of arena.blocks)if(Math.abs(a.x-b.x)<b.w/2+RULES.radius&&Math.abs(a.z-b.z)<b.d/2+RULES.radius&&a.y>=b.h-1e-6&&nextY<=b.h)f=Math.max(f??-Infinity,b.h);
   if(f!==null&&nextY<=f){a.y=f;a.vy=0;a.grounded=true;a.sliding=a.sliding&&input.crouch===true;a.traversalFlight=false;a.traversalTarget=null;}else{a.y=nextY;a.grounded=false;}
   const target=a.traversalTarget,targetFloor=target&&floorAt(target.x,target.z,arena);if(a.traversalFlight&&target&&targetFloor!==null&&a.vy<=0&&Math.hypot(a.x-target.x,a.z-target.z)<=.9&&a.y<=targetFloor+.35){a.x=target.x;a.z=target.z;a.y=targetFloor;a.vx=a.vy=a.vz=0;a.grounded=true;a.traversalFlight=false;a.traversalTarget=null;}
  const bounds=boundsOf(arena);a.x=clamp(a.x,bounds.minX,bounds.maxX);a.z=clamp(a.z,bounds.minZ,bounds.maxZ);
 }
 // Cancel a slide that dropped below its speed floor after the minimum duration.
 if(a.sliding&&a.grounded&&(a.slideTimer||0)<=0&&Math.hypot(a.vx,a.vz)<3)a.sliding=false;
    const {pads,teleporters,ziplines}=traversalTables(arena);
    const floor=floorAt(a.x,a.z,arena),pad=pads.find(p=>floor!==null&&Math.hypot(a.x-p.x,a.z-p.z)<.7&&Math.abs(a.y-floor)<.35&&a.grounded);
    const teleporter=a.vehicleId===null&&(a.traversalCooldown||0)<=0?teleporters.find(p=>Math.hypot(a.x-p.x,a.z-p.z)<.85&&Math.abs(a.y-(Number.isFinite(p.y)?p.y:(floor??a.y)))<.7):null;
    const zipline=!a.zipRide&&!teleporter&&floor!==null&&a.grounded&&(a.traversalCooldown||0)<=0?ziplines.find(z=>{const from=resolvePoint(z.from);return from&&Math.hypot(a.x-from.x,a.z-from.z)<.9&&Math.abs(a.y-(from.y??floor))<.7;}):null;
    if(teleporter){const from={x:a.x,y:a.y,z:a.z},to=resolvePoint(teleporter.to);if(to){a.x=to.x;a.y=Number.isFinite(to.y)?to.y:(floorAt(to.x,to.z,arena)??a.y);a.z=to.z;a.vx=a.vy=a.vz=0;a.grounded=true;a.traversalCooldown=teleporter.cooldown??1;a.traversalPad=teleporter.id;a.lastValid={x:a.x,y:a.y,z:a.z};a.traversalEvent={type:'teleport',id:teleporter.id,from,to:{x:a.x,y:a.y,z:a.z}};}}
    else if(zipline){const from=resolvePoint(zipline.from),to=resolvePoint(zipline.to),fy=Number.isFinite(from.y)?from.y:floor,ty=Number.isFinite(to.y)?to.y:(floorAt(to.x,to.z,arena)??fy),distance=Math.hypot(to.x-from.x,ty-fy,to.z-from.z),speed=zipline.speed??9;a.zipRide={from:{x:from.x,y:fy,z:from.z},to:{x:to.x,y:ty,z:to.z},t:0,duration:Math.max(.35,distance/speed)};a.grounded=false;a.traversalCooldown=zipline.cooldown??1.2;a.traversalPad=zipline.id;a.traversalEvent={type:'zipline',id:zipline.id,from:{x:from.x,y:fy,z:from.z},to:{x:to.x,y:ty,z:to.z}};}
   else if(pad&&a.traversalPad!==pad.id&&(a.traversalCooldown||0)<=0){
    if(pad.type==='trampoline')a.vy=Math.max(a.vy,pad.power??RULES.jump*1.5);
     else {const gravity=RULES.gravity*(config.gravity??1),target=pad.target,deltaY=(target?.y??0)-a.y,launchY=pad.vy??(pad.power??14)*.55,discriminant=launchY*launchY-2*gravity*deltaY,time=target&&discriminant>=0?(launchY+Math.sqrt(discriminant))/gravity:null,d=target&&time>0?norm(v((target.x-a.x)/time,0,(target.z-a.z)/time)):norm(v(pad.dir?.[0]??0,0,pad.dir?.[1]??0)),horizontal=target?Math.hypot(target.x-a.x,target.z-a.z)/(time||1):pad.power??14;a.vx=d.x*horizontal;a.vz=d.z*horizontal;a.vy=launchY;a.traversalTarget=target||null;}
    a.grounded=false;a.traversalFlight=pad.type==='boost';a.traversalCooldown=pad.cooldown??1;a.traversalPad=pad.id;
   }else if(!pad)a.traversalPad=null;
    a.traversalCooldown=Math.max(0,(a.traversalCooldown||0)-dt);
   const support=supportAt(a.x,a.z,arena);if(a.grounded&&support!==null&&Math.abs(a.y-support)<.35)a.lastValid={x:a.x,y:a.y,z:a.z};
}
function boxHit(o,d,b,max){let lo=0,hi=max;for(const k of ['x','y','z']){const c=k==='y'?b.h/2:b[k],s=k==='x'?b.w/2:k==='z'?b.d/2:b.h/2;if(Math.abs(d[k])<1e-8){if(o[k]<c-s||o[k]>c+s)return null;}else{let t1=(c-s-o[k])/d[k],t2=(c+s-o[k])/d[k];if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)return null;}}return lo;}
  export function rayWorld(o,d,max=100,arena=MAPS[0]){if(!finitePoint(o)||!finitePoint(d)||(!Number.isFinite(max)&&max!==Infinity)||max<0||Math.hypot(d.x,d.y,d.z)<=1e-9)return 0;let best=max;for(const b of arena.blocks){const t=boxHit(o,d,b,best);if(t!==null&&t<best)best=t;}
   if(arena.terrain){const hit=terrainRayHit(o,d,best,arena.terrain);if(hit&&hit.distance<best)best=hit.distance;}
   else {
    // Analytic floor/ramp intersection by bounded ray marching, refined at first crossing.
    for(let t=.12;t<best;t+=.16){const p=add(o,d,t),floor=floorAt(p.x,p.z,arena);if(floor!==null&&p.y<floor){let lo=Math.max(0,t-.16),hi=t;for(let i=0;i<7;i++){const m=(lo+hi)/2,q=add(o,d,m),qFloor=floorAt(q.x,q.z,arena);if(qFloor!==null&&q.y<qFloor)hi=m;else lo=m;}best=hi;break;}}
   }
  return best;}
 export function visible(a,b,arena=MAPS[0]){if(!finitePoint(a)||!finitePoint(b))return false;const delta=v(b.x-a.x,b.y-a.y,b.z-a.z),l=Math.hypot(delta.x,delta.y,delta.z);if(!Number.isFinite(l))return false;if(l<=1e-9)return true;return rayWorld(a,norm(delta),l,arena)>=l-.08;}
function actorHit(o,d,a,max){return boxHit(o,d,{x:a.x,z:a.z,w:.85,d:.85,h:1.8},max);}
function hitActor(o,d,a,max){const local=v(o.x,o.y-a.y,o.z);return actorHit(local,d,a,max);}
function hitVehicle(o,d,vehicle,max){const p=vehicle.position,local=v(o.x-p.x,o.y-p.y,o.z-p.z),size=vehicle.config?.dimensions||GUNTRUCK.dimensions;return boxHit(local,d,{x:0,z:0,w:size.width,d:size.length,h:size.height},max);}
const vehicleRadius=vehicle=>Math.hypot((vehicle.config?.dimensions||GUNTRUCK.dimensions).width/2,(vehicle.config?.dimensions||GUNTRUCK.dimensions).length/2);
export function walkEdge(a,b,arena=MAPS[0]){const l=dist(a,b);if(l>6.5)return false;const n=Math.max(1,Math.ceil(l/.2));let prev=a.y;for(let i=0;i<=n;i++){const x=a.x+(b.x-a.x)*i/n,z=a.z+(b.z-a.z)*i/n;let y=floorAt(x,z,arena);if(y===null)return false;for(const block of arena.blocks)if(block.kind==='deck'&&Math.abs(x-block.x)<block.w/2+.52&&Math.abs(z-block.z)<block.d/2+.52&&Math.abs(block.h-y)<.25)y=Math.max(y,block.h);if(Math.abs(y-prev)>.3||obstructed(x,y,z,.52,arena))return false;prev=y;}return true;}
 function navigationEdges(nodes,arena){
  // Next-gen maps can be large and organic; connect only nearby nodes via a
  // spatial grid so the graph stays O(n) instead of O(n^2).
  const edges=nodes.map(()=>[]),cell=7,buckets=new Map(),key=(n)=>`${Math.round(n.x/cell)},${Math.round(n.z/cell)}`;
  nodes.forEach((n,i)=>{const k=key(n);let b=buckets.get(k);if(!b){b=[];buckets.set(k,b);}b.push(i);});
  nodes.forEach((a,i)=>{
   const cx=Math.round(a.x/cell),cz=Math.round(a.z/cell);
   for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const b=buckets.get(`${cx+dx},${cz+dz}`);if(!b)continue;for(const j of b){if(j<=i)continue;const c=nodes[j];if(Math.hypot(a.x-c.x,a.z-c.z)>6.5)continue;if(walkEdge(a,c,arena)){edges[i].push(j);edges[j].push(i);}}}
  });
  return edges;
 }
 function pruneToLargestComponent(nodes,edges){
  if(nodes.length<2)return;
  const comp=new Array(nodes.length).fill(-1),comps=[];
  for(let s=0;s<nodes.length;s++){if(comp[s]>=0)continue;const id=comps.length,list=[],q=[s];comp[s]=id;for(let head=0;head<q.length;head++){const n=q[head];list.push(n);for(const j of edges[n])if(comp[j]<0){comp[j]=id;q.push(j);}}comps.push(list);}
  if(comps.length<2)return;
  let best=comps[0];for(const c of comps)if(c.length>best.length)best=c;
  if(best.length===nodes.length)return;
  const keep=new Map();best.forEach((idx,pos)=>keep.set(idx,pos));
  const newNodes=best.map(idx=>nodes[idx]),newEdges=best.map(idx=>edges[idx].filter(j=>keep.has(j)).map(j=>keep.get(j)));
  nodes.length=0;nodes.push(...newNodes);edges.length=0;edges.push(...newEdges);
 }
  export function navigation(arena=MAPS[0]){const nodes=[],grid=new Map(),cell=.1;const addNode=(x,z)=>{const y=floorAt(x,z,arena);if(y===null)return;if(obstructed(x,y,z,.65,arena))return;const cx=Math.floor(x/cell),cz=Math.floor(z/cell);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const bucket=grid.get(`${cx+dx}|${cz+dz}`);if(bucket)for(const i of bucket)if(Math.hypot(nodes[i].x-x,nodes[i].z-z)<.1)return;}const key=`${cx}|${cz}`;let bucket=grid.get(key);if(!bucket){bucket=[];grid.set(key,bucket);}bucket.push(nodes.length);nodes.push(v(x,y,z));};
   // Racing uses its centerline driver, not an infantry grid over hundreds of rails.
   // Keep the public navigation graph useful for registry validation and tooling.
   if(arena.race){
    for(const p of [...(arena.navNodes||[]),...(arena.race.centerline||[]),...(arena.race.grid||[]),...(arena.race.itemBoxes||[])])addNode(Array.isArray(p)?p[0]:p.x,Array.isArray(p)?p[1]:p.z);
    return {nodes,edges:navigationEdges(nodes,arena)};
   }
   const bounds=boundsOf(arena),step=arena.nextGen?6:3;for(let x=Math.ceil(bounds.minX/step)*step;x<=bounds.maxX;x+=step)for(let z=Math.ceil(bounds.minZ/step)*step;z<=bounds.maxZ;z+=step)addNode(x,z);if(arena.raised)for(const [x,z]of [[-1.8,-3.6],[1.8,-3.6],[-1.8,-6],[1.8,-6],[0,-7.5],[-6,-7.5],[6,-7.5]])addNode(x,z);for(const p of arena.navNodes||[]){const nx=Array.isArray(p)?p[0]:p.x,nz=Array.isArray(p)?p[1]:p.z;addNode(nx,nz);}for(const [,x,z]of arena.pickups)addNode(x,z);for(const [x,z]of arena.spawns)addNode(x,z);for(const p of [...traversalSource(arena,'trampolines'),...traversalSource(arena,'jumpPads'),...traversalSource(arena,'boostLaunchers'),...traversalSource(arena,'launchers'),...traversalSource(arena,'teleporters')])addNode(p.x,p.z);const edges=arena.nextGen?navigationEdges(nodes,arena):nodes.map((a,i)=>nodes.map((b,j)=>j!==i&&walkEdge(a,b,arena)?j:-1).filter(j=>j>=0));for(const link of arena.jumpLinks||[]){const from=nearest(link.source,nodes),to=nearest(link.target,nodes);if(from!==to&&!edges[from].includes(to))edges[from].push(to);}const addLinkEdge=(from,to)=>{const f=nearest(from,nodes),t=nearest(to,nodes);if(f!==t&&!edges[f].includes(t))edges[f].push(t);};for(const tp of traversalSource(arena,'teleporters')){const to=resolvePoint(tp.target??tp.to);if(Number.isFinite(tp.x)&&to)addLinkEdge({x:tp.x,y:0,z:tp.z},{x:to.x,y:to.y??0,z:to.z});}if(arena.nextGen)pruneToLargestComponent(nodes,edges);return {nodes,edges};}
const navigationCache=new Map();
function matchNavigation(arena){
 if(!navigationCache.has(arena)){
  const graph=navigation(arena);
  graph.nodes.forEach(Object.freeze);graph.edges.forEach(Object.freeze);
  Object.freeze(graph.nodes);Object.freeze(graph.edges);navigationCache.set(arena,Object.freeze(graph));
 }
 return navigationCache.get(arena);
}
export function nearest(p,nodes){let id=0,best=Infinity;nodes.forEach((n,i)=>{const d=dist(p,n);if(d<best){id=i;best=d;}});return id;}

function applyHarnessProfile(a){const passive=harnessPassive(a.harness),ability=harnessAbility(a.harness);a.harnessSpeedMultiplier=passive?.speed??1;a.harnessResistance=passive?.resistance??0;a.harnessDamageMultiplier=passive?.damage??1;a.activeSpeedMultiplier=ability?.speed??(a.harness==='hermes'?1.6:1);}
export class Match{
 visible(a,b){return visible(a,b,this.arena);}
 rayWorld(o,d,max){return rayWorld(o,d,max,this.arena);}
    constructor(character='chatgpt',harness='openclaw',random=Math.random,mapId='exchange',options={}){
    this.config=normalizeConfig(options);this.humanCount=Math.max(1,Math.min(Math.round(options.humanCount??1),8));
    const vehicleMode=this.config.mode==='puma-race'||this.config.mode==='puma-soccer';
    if(vehicleMode){this.config.botCount=this.config.mode==='puma-soccer'?Math.max(0,Math.min(3,4-this.humanCount)):Math.min(this.config.botCount,8-this.humanCount);if(!getMap(mapId).race)mapId=this.config.mode==='puma-soccer'?'puma-pitch':'puma-circuit';}
    this.difficulty=DIFFICULTIES.find(d=>d.id===this.config.difficulty);this.arena=getMap(mapId);const nav=vehicleMode?{nodes:[],edges:[]}:matchNavigation(this.arena);this.nav=nav.nodes;this.edges=nav.edges;{const arenaBounds=boundsOf(this.arena);this.center={x:(arenaBounds.minX+arenaBounds.maxX)/2,z:(arenaBounds.minZ+arenaBounds.maxZ)/2};}this.spawns=this.arena.spawns.map(([x,z])=>v(x,floorAt(x,z,this.arena),z));this.random=random;this.time=0;this.over=false;this.suddenDeath=false;this.armsraceWinner=null;this.events=[];this.feed=[];this.rockets=[];this.stats={shots:0,kills:0,pickups:0,powers:0,respawns:0,falls:0};this.serial=0;this.teamScores={0:0,1:0};this.vehicleHits=new Map();
   const defaults={0:this.arena.spawns.filter((_,i)=>i%2===0),1:this.arena.spawns.filter((_,i)=>i%2===1)};
    this.teamSpawns=teamPoints(this.arena.teamSpawns,defaults);
    // Team-only maps author no FFA spawn list. Derive one from the navigation
    // graph (points that are guaranteed reachable by bots) so a teamless mode
    // never collapses every actor onto the single, possibly obstructed origin.
    if(!this.spawns.length){
      const nodes=(this.nav||[]).filter(p=>floorAt(p.x,p.z,this.arena)!==null);
      if(nodes.length){
        const count=Math.min(10,nodes.length);
        this.spawns=Array.from({length:count},(_,i)=>{const p=nodes[Math.round(i*(nodes.length-1)/(count-1||1))];return v(p.x,floorAt(p.x,p.z,this.arena),p.z);});
      }else this.spawns=[...(this.teamSpawns[0]||[]),...(this.teamSpawns[1]||[])].map(([x,z])=>v(x,floorAt(x,z,this.arena),z));
    }
   const flagFallback=team=>{const spawn=this.teamSpawns[team]?.[0],sx=Array.isArray(spawn)?spawn[0]:spawn?.x,sz=Array.isArray(spawn)?spawn[1]:spawn?.z;if(Number.isFinite(sx)&&Number.isFinite(sz))return [sx,sz];const derived=(this.spawns||[]).find((p,i)=>i%2===team);return derived&&Number.isFinite(derived.x)&&Number.isFinite(derived.z)?[derived.x,derived.z]:[this.center.x,this.center.z];};
   this.flagSpawns=flagPoints(this.arena.flagSpawns,{0:flagFallback(0),1:flagFallback(1)});
   for(const team of [0,1])if(!Number.isFinite(this.flagSpawns[team][0])||!Number.isFinite(this.flagSpawns[team][1]))this.flagSpawns[team]=[this.center.x,this.center.z];
    this.flags=this.config.mode==='ctf'?{0:{team:0,state:'at-base',x:this.flagSpawns[0][0],z:this.flagSpawns[0][1],carrier:null},1:{team:1,state:'at-base',x:this.flagSpawns[1][0],z:this.flagSpawns[1][1],carrier:null}}:[];
    for(const f of Object.values(this.flags))f.y=floorAt(f.x,f.z,this.arena)??0;
    this.objectiveState=this.config.mode==='payload'?payloadTemplate(this.arena,{segments:this.config.fragLimit,navigation:nav,floorAt,walkEdge,obstructed}):objectiveTemplate(this.config.mode,this.arena,this.config);this.objectiveEventState=new Map();
  // Objective zones must sit on ground the nav graph can reach; a zone on an isolated walkable pocket leaves bots stranded just outside its radius.
  if(this.objectiveState&&(this.objectiveState.kind==='koth'||this.objectiveState.kind==='domination'))for(const zone of this.objectiveState.zones){const node=this.nav[nearest(zone,this.nav)];if(node&&Math.hypot(node.x-zone.x,node.z-zone.z)>2.5){zone.x=node.x;zone.z=node.z;if(Number.isFinite(node.y))zone.y=node.y;}}
  this.vehicles=(this.arena.vehicles||[]).map((template,id)=>{const vehicle=createVehicle(template),position={x:Number.isFinite(template.x)?template.x:0,y:Number.isFinite(template.y)?template.y:floorAt(template.x||0,template.z||0,this.arena)??0,z:Number.isFinite(template.z)?template.z:0};vehicle.id=template.id??`${vehicle.template}-${id}`;vehicle.kind=template.kind??GUNTRUCK.id;vehicle.spawn={...position};respawnVehicle(vehicle,position,template.yaw??0);return vehicle;});
  this.pickups=this.arena.pickups.map(([kind,x,z],id)=>({id,kind,x,z,y:floorAt(x,z,this.arena),wait:0}));
 this.pickups=this.pickups.filter(p=>this.config.mode!=='instagib'&&(modeWeapon(this.config)===null||p.kind==='health'||p.kind==='armor'));
  this.actors=[this.actor(0,character,harness),...Array.from({length:this.humanCount-1},(_,i)=>this.actor(i+1,CHARACTERS[(CHARACTERS.findIndex(c=>c.id===character)+i+1)%CHARACTERS.length].id,HARNESSES[Math.floor(this.random()*HARNESSES.length)].id)),...Array.from({length:this.config.botCount},(_,i)=>this.actor(this.humanCount+i,CHARACTERS[(CHARACTERS.findIndex(c=>c.id===character)+this.humanCount+i)%CHARACTERS.length].id,HARNESSES[Math.floor(this.random()*HARNESSES.length)].id))];this.actors[0].name=this.config.playerName||this.actors[0].name;
      for(const a of this.actors){const loadout=options.loadouts?.[a.id];if(a.id<this.humanCount&&loadout){Object.assign(a,resolveLoadout(loadout.character,loadout.harness));a.name=CHARACTERS.find(c=>c.id===a.character).name;}a.gear=loadout?.gear?resolveGear(loadout.gear).modifiers:null;a.attachments=loadout?.attachments?resolveAttachments(loadout.attachments):null;a.finish=loadout?.finish??null;applyHarnessProfile(a);this.spawn(a);}
      if(this.config.mode==='puma-race')this.initializeRace();
      else if(this.config.mode==='puma-soccer')this.initializeSoccer();
      else if(this.config.mode==='horde'||this.config.mode==='campaign')this.initializeSinglePlayer();
    }
    initializeRace(){return initializeRace(this);}
    stepRace(dt,inputs={}){return stepRace(this,dt,inputs);}
    initializeSoccer(){return initializeSoccer(this);}
    stepSoccer(dt,inputs={}){return stepSoccer(this,dt,inputs);}
    initializeSinglePlayer(){return initializeSinglePlayer(this);}
    updateSinglePlayer(dt){return updateSinglePlayer(this,dt);}
      actor(id,character,harness){const l=resolveLoadout(character,harness),actor={id,...l,team:teamMode(this.config)?id%2:undefined,name:CHARACTERS.find(c=>c.id===l.character).name,frags:0,deaths:0,streak:0,ladder:0,scoreStats:{captures:0,flagPickups:0,flagReturns:0,flagDrops:0,objectiveTime:0,objectiveCaptures:0,objectiveNeutralizations:0,objectiveContests:0},x:0,y:0,z:0,lastValid:null,vx:0,vy:0,vz:0,yaw:0,pitch:0,bodyYaw:0,grounded:true,coyote:0,jumpBuffer:0,health:0,armor:0,dead:0,vehicleId:null,vehicleSeat:null,vehicleSeatIndex:0,weapon:modeWeapon(this.config)??(this.config.mode==='arsenal'?0:this.config.startingWeapon),ammo:spawnInventory(this.config),cooldown:0,active:0,slow:0,slowMultiplier:.55,shotWait:0,grenadeCooldown:0,protection:0,shots:0,traversalCooldown:0,traversalPad:null,traversalTarget:null,zipRide:null,spread:0,punchYaw:0,punchPitch:0,punchVelYaw:0,punchVelPitch:0,reloading:false,reloadTimer:0,reloadDuration:0,reloadWeapon:-1,melee:0,weaponSwitch:0,burst:0,burstTimer:0,sprinting:false,crouching:false,sliding:false,slideTimer:0,slideCooldown:0,eyeHeight:MOVE.eyeStanding,baseHeight:MOVE.baseHeight,ads:false,jumpHeld:false,jumpCutArmed:false,powerups:{},speedMultiplier:1,damageMultiplier:1,cooldownMultiplier:1,temporaryShield:0,activeSpeedMultiplier:1,harnessSpeedMultiplier:1,harnessResistance:0,bot:id<this.humanCount?null:{route:[],think:0,target:-1,memory:0,reaction:0,stuck:0,last:v(),state:'roam',patrol:0,flank:null,flankDone:false,recover:0,suppressed:0,threat:-1,standoff:null,strafeReverse:-99}};applyHarnessProfile(actor);actor.botScan=botScanRange(this.difficulty,this.arena);return actor;}
  emit(type,data={}){this.events.push({type,id:++this.serial,time:this.time,...data});if(this.events.length>300)this.events.shift();}
  vehicleById(id){return this.vehicles.find(vehicle=>vehicle.id===id)||null;}
  flagCarrier(a){return this.config.mode==='ctf'&&Object.values(this.flags).some(flag=>flag.carrier===a.id);}
  defensivePost(a){return bots.defensivePost(this,a);}
  flankDestination(a,enemy){return bots.flankDestination(this,a,enemy);}
  patrolPoint(a){return bots.patrolPoint(this,a);}
  separation(a,radius=2.6){return bots.separation(this,a,radius);}
  spreadBias(a,point){return bots.spreadBias(this,a,point);}
  zoneSlot(a,zone,team){return bots.zoneSlot(this,a,zone,team);}
  zoneDefense(a,owned){return bots.zoneDefense(this,a,owned);}
   vehicleCollision(next,vehicle){const radius=vehicleRadius(vehicle),bounds=boundsOf(this.arena),flight=vehicle.config?.flight===true;if(next.x<bounds.minX+radius||next.x>bounds.maxX-radius||next.z<bounds.minZ+radius||next.z>bounds.maxZ-radius)return false;const floor=floorAt(next.x,next.z,this.arena);if(floor===null)return false;if(flight){const altitude=clamp(next.y,floor+(vehicle.config?.hoverHeight??1.6),vehicle.config?.maxAltitude??58);if(obstructed(next.x,altitude,next.z,radius,this.arena))return false;return {...next,y:altitude};}if(obstructed(next.x,floor,next.z,radius,this.arena))return false;return {...next,y:floor};}
    syncVehicleActor(a,vehicle){a.vehicleId=vehicle.id;const seat=vehicleMounted(vehicle,a.id);a.vehicleSeat=seat?.role??'passenger';a.vehicleSeatIndex=seat?.index??0;const p=vehicleSeatPosition(vehicle,a.vehicleSeat,a.vehicleSeatIndex);a.x=p.x;a.y=p.y;a.z=p.z;if(a.vehicleSeat!=='driver'&&a.vehicleSeat!=='gunner')a.yaw=p.yaw;a.vx=vehicle.velocity.x;a.vz=vehicle.velocity.z;a.vy=0;a.grounded=true;a.lastValid={x:a.x,y:a.y,z:a.z};}
    releaseVehicle(a,vehicle=this.vehicleById(a.vehicleId),reason='exit'){
    if(this.race)return false;
    if(!vehicle){a.vehicleId=null;a.vehicleSeat=null;a.vehicleSeatIndex=0;a.vx=a.vy=a.vz=0;a.grounded=true;return false;}leaveVehicleSeat(vehicle,a.id);const flight=vehicle.config?.flight===true,size=vehicle.config?.dimensions||GUNTRUCK.dimensions,right=v(Math.cos(vehicle.heading),0,-Math.sin(vehicle.heading)),candidates=[add(vehicle.position,right,size.width/2+RULES.radius+.18),add(vehicle.position,right,-(size.width/2+RULES.radius+.18)),add(vehicle.position,right,0)];let chosen=flight?{x:vehicle.position.x,y:vehicle.position.y,z:vehicle.position.z}:null;if(!chosen)for(const candidate of candidates){const y=floorAt(candidate.x,candidate.z,this.arena);if(y!==null&&!obstructed(candidate.x,y,candidate.z,RULES.radius,this.arena)){chosen={x:candidate.x,y,z:candidate.z};break;}}a.vehicleId=null;a.vehicleSeat=null;a.vehicleSeatIndex=0;if(chosen){Object.assign(a,chosen);a.lastValid={...chosen};}a.vx=a.vy=a.vz=0;a.grounded=!flight;this.emit('vehicle-exit',{actor:a.id,vehicle:vehicle.id,reason});return true;}
    enterVehicle(a){if(this.flagCarrier(a))return false;const vehicle=this.vehicles.find(candidate=>{if(!vehicleSeatFor(candidate)||vehicleMounted(candidate,a.id))return false;return Math.hypot(a.x-candidate.position.x,a.z-candidate.position.z)<2.4&&Math.abs(a.y-candidate.position.y)<(candidate.config?.flight===true?3.2:2.4);});if(!vehicle)return false;const seat=vehicleSeatFor(vehicle);takeVehicleSeat(vehicle,a.id,seat.role,seat.index);this.syncVehicleActor(a,vehicle);if(Number.isFinite(a.team))vehicle.lastTeam=a.team;if(seat.role==='driver')a.yaw=vehicle.heading-Math.PI;this.emit('vehicle-enter',{actor:a.id,vehicle:vehicle.id,seat:seat.role});return true;}
   vehicleOccupants(vehicle){return [vehicle.driver,vehicle.gunner,...(vehicle.passengers||[])].filter(id=>id!=null);}
  vehicleTeam(vehicle){for(const id of this.vehicleOccupants(vehicle)){const occupant=this.actors.find(a=>a.id===id);if(occupant&&Number.isFinite(occupant.team))return occupant.team;}return undefined;}
  vehicleFriendlyFire(vehicle,source){const crew=this.vehicleTeam(vehicle)??vehicle?.lastTeam;return Boolean(teamMode(this.config)&&source&&Number.isFinite(crew)&&crew===source.team&&!this.vehicleOccupants(vehicle).includes(source.id));}
   damageVehicle(vehicle,amount,source){if(this.race||!vehicle||vehicle.health<=0||this.over||this.vehicleFriendlyFire(vehicle,source))return 0;const driver=this.actors.find(a=>a.id===vehicle.driver),skill=driver?harnessVehicle(driver.harness):null,actual=Math.min(vehicle.health,Math.max(0,amount*this.config.damage*(skill?.armor??1)));vehicle.health-=actual;this.emit('vehicle-damage',{vehicle:vehicle.id,actor:source?.id,amount:actual,health:vehicle.health});if(vehicle.health<=0){const occupants=[vehicle.driver,vehicle.gunner,...(vehicle.passengers||[])].filter(id=>id!=null).map(id=>this.actors.find(a=>a.id===id)).filter(Boolean);for(const occupant of occupants)this.releaseVehicle(occupant,vehicle,'destroyed');if(driver)this.damage(driver,70,source);else for(const occupant of occupants)this.damage(occupant,40,source);vehicle.health=0;vehicle.respawnTimer=vehicle.config?.respawn??GUNTRUCK.respawn;vehicle.velocity.x=vehicle.velocity.z=0;this.emit('vehicle-destroyed',{vehicle:vehicle.id,actor:source?.id,pos:{...vehicle.position}});}return actual;}
       fireVehicle(vehicle,a,aimYaw=a.yaw,aimPitch=a.pitch){if(!vehicle.lastStep?.fired)return;const skill=harnessVehicle(a.harness),damageScale=skill?.gunnerDamage??1,gun=GUNTRUCK.mountedChaingun,origins=vehicleMuzzles(vehicle),base=aim(aimYaw+(a.punchYaw||0),aimPitch+(a.punchPitch||0));const pivot=v(vehicle.position.x,vehicle.position.y+1.18,vehicle.position.z),pivotDir=norm(add(base,v((this.random()-.5)*.018,(this.random()-.5)*.018,(this.random()-.5)*.018)));let pivotRange=this.rayWorld(pivot,pivotDir,gun.range);for(const other of this.actors)if(other!==a&&other.health>0&&!vehicleMounted(vehicle,other.id)&&(!teamMode(this.config)||other.team!==a.team)){const hit=hitActor(pivot,pivotDir,other,pivotRange);if(hit!==null&&hit<pivotRange)pivotRange=hit;}for(const other of this.vehicles)if(other!==vehicle&&other.health>0&&!this.vehicleFriendlyFire(other,a)){const hit=hitVehicle(pivot,pivotDir,other,pivotRange);if(hit!==null&&hit<pivotRange)pivotRange=hit;}const focus=add(pivot,pivotDir,pivotRange);for(const barrel of vehicle.lastStep.muzzles||[0,1]){if(!origins[barrel]||!finitePoint(origins[barrel]))continue;const spread=.018,direction=norm(add(norm(v(focus.x-origins[barrel].x,focus.y-origins[barrel].y,focus.z-origins[barrel].z)),v((this.random()-.5)*spread,(this.random()-.5)*spread,(this.random()-.5)*spread)));if(!finitePoint(direction))continue;let range=this.rayWorld(origins[barrel],direction,gun.range),target=null,vehicleTarget=null;for(const other of this.actors)if(other!==a&&other.health>0&&!vehicleMounted(vehicle,other.id)&&(!teamMode(this.config)||other.team!==a.team)){const hit=hitActor(origins[barrel],direction,other,range);if(hit!==null){range=hit;target=other;vehicleTarget=null;}}for(const other of this.vehicles)if(other!==vehicle&&other.health>0&&!this.vehicleFriendlyFire(other,a)){const hit=hitVehicle(origins[barrel],direction,other,range);if(hit!==null&&hit<range){range=hit;target=null;vehicleTarget=other;}}if(target)this.damage(target,gun.damage*damageScale,a);else if(vehicleTarget)this.damageVehicle(vehicleTarget,gun.damage*damageScale,a);this.emit('vehicle-shot',{vehicle:vehicle.id,actor:a.id,barrel,weapon:0,from:origins[barrel],to:add(origins[barrel],direction,range),hit:target?.id??vehicleTarget?.id??null});}a.shots+=2;this.stats.shots+=2;}
   vehicleGround(x,z){const y=floorAt(x,z,this.arena);if(y===null)return null;if(!this.arena.terrain)return y;const e=.6,yx=floorAt(x+e,z,this.arena),yz=floorAt(x,z+e,this.arena);if(yx!==null&&yz!==null)return {y,normal:norm(v(-(yx-y)/e,1,-(yz-y)/e))};return y;}
    autoGunnerTarget(vehicle,a){let best=null,bestD=Infinity;const origin=v(vehicle.position.x,vehicle.position.y+1.7,vehicle.position.z);for(const b of this.actors){if(b===a||b.health<=0||(teamMode(this.config)&&b.team===a.team))continue;const d=Math.hypot(b.x-vehicle.position.x,b.z-vehicle.position.z);if(d>90||d>=bestD)continue;if(!this.visible(origin,eye(b)))continue;bestD=d;best={x:b.x,y:b.y,z:b.z};}return best;}
    driveVehicle(a,controls,dt){const vehicle=this.vehicleById(a.vehicleId);if(!vehicle||a.vehicleSeat!=='driver'||vehicle.driver!==a.id){if(a.vehicleSeat==='driver'){a.vehicleId=null;a.vehicleSeat=null;}return false;}if(controls.interact){this.releaseVehicle(a,vehicle);return true;}if(a.bot){const now=this.time;if(a.bot.vstuckAt===undefined||Math.hypot(a.x-(a.bot.vstuckX??a.x),a.z-(a.bot.vstuckZ??a.z))>1.5){a.bot.vstuckX=a.x;a.bot.vstuckZ=a.z;a.bot.vstuckAt=now;}else if(now-a.bot.vstuckAt>3){this.releaseVehicle(a,vehicle,'stuck');a.bot.vehicleCooldown=5;a.bot.recover=.4;a.bot.think=0;return true;}}const skill=harnessVehicle(a.harness),flight=vehicle.config?.flight===true,forward=v(-Math.sin(a.yaw),0,-Math.cos(a.yaw)),right=v(Math.cos(a.yaw),0,-Math.sin(a.yaw)),throttle=clamp((controls.x||0)*forward.x+(controls.z||0)*forward.z,-1,1),steer=clamp(-((controls.x||0)*right.x+(controls.z||0)*right.z),-1,1),look=aim(a.yaw,a.pitch),hasGunner=vehicle.gunner!==null,turretYaw=Math.atan2(look.x,look.z)-vehicle.heading,foe=a.bot&&a.bot.target>=0?this.actors[a.bot.target]:null,botFire=Boolean(foe&&foe.health>0&&a.bot.memory>0&&this.visible(eye(a),eye(foe))),auto=(!hasGunner&&skill?.autogunner&&controls.fire!==true)?this.autoGunnerTarget(vehicle,a):null;let fireAim=null;if(auto){const muzzles=vehicleMuzzles(vehicle),m=muzzles[0]||{x:vehicle.position.x,y:vehicle.position.y+.9,z:vehicle.position.z},dir=norm(v(auto.x-m.x,(auto.y??0)+.9-m.y,auto.z-m.z));fireAim={yaw:Math.atan2(-dir.x,-dir.z),pitch:Math.asin(clamp(dir.y,-1,1)),turretYaw:Math.atan2(dir.x,dir.z)-vehicle.heading};}stepVehicle(vehicle,{throttle,steer,lift:flight?(controls.jump===true?1:controls.crouch===true?-1:0):0,brake:flight?false:controls.jump===true,boost:controls.sprint===true,speedScale:skill?.speed??1,boostScale:skill?.boost??1,traverseScale:skill?.traverse??1,fire:!hasGunner&&(controls.fire===true||botFire||Boolean(auto)),turretYaw:hasGunner?undefined:(fireAim?fireAim.turretYaw:turretYaw)},dt,next=>this.vehicleCollision(next,vehicle),(x,z)=>this.vehicleGround(x,z));if(skill?.repair&&vehicle.health>0&&vehicle.health<vehicle.maxHealth)vehicle.health=Math.min(vehicle.maxHealth,vehicle.health+skill.repair*dt);this.syncVehicleActor(a,vehicle);this.fireVehicle(vehicle,a,fireAim?.yaw??a.yaw,fireAim?.pitch??a.pitch);return true;}
    gunnerVehicle(a,controls,dt){const vehicle=this.vehicleById(a.vehicleId);if(!vehicle||vehicle.gunner!==a.id){if(a.vehicleSeat==='gunner'){a.vehicleId=null;a.vehicleSeat=null;}return false;}if(controls.interact){this.releaseVehicle(a,vehicle);return true;}const aimYaw=a.yaw,aimPitch=a.pitch,look=aim(aimYaw,aimPitch),turretYaw=Math.atan2(look.x,look.z)-vehicle.heading,foe=a.bot&&a.bot.target>=0?this.actors[a.bot.target]:null,botFire=Boolean(foe&&foe.health>0&&a.bot.memory>0&&this.visible(eye(a),eye(foe)));stepVehicleWeapon(vehicle,{fire:controls.fire===true||botFire,turretYaw},dt);this.syncVehicleActor(a,vehicle);this.fireVehicle(vehicle,a,aimYaw,aimPitch);return true;}
     spawn(a){if(a.vehicleId!==null)this.releaseVehicle(a,undefined,'respawn');const others=this.actors?.filter(b=>b!==a&&b.health>0)||[];const pool=teamMode(this.config)?this.teamSpawns[a.team]:this.spawns;let best=-Infinity,chosen=v();for(const s of pool){const sx=Array.isArray(s)?s[0]:s.x,sz=Array.isArray(s)?s[1]:s.z,pos=v(sx,floorAt(sx,sz,this.arena),sz);const score=(others.length?Math.min(...others.map(b=>dist(b,pos))):0)+this.random()*2;if(score>best){best=score;chosen=pos;}}
  // Safety net: never spawn inside geometry even if an authored point is blocked.
  const chosenFloor=floorAt(chosen.x,chosen.z,this.arena);
  if(chosenFloor===null||obstructed(chosen.x,chosenFloor,chosen.z,RULES.radius,this.arena)){const node=this.nav.length?this.nav[nearest(chosen,this.nav)]:null,nodeFloor=node?floorAt(node.x,node.z,this.arena):null;if(node&&nodeFloor!==null)chosen=v(node.x,nodeFloor,node.z);else{const pool=[...(this.spawns||[]),...(this.teamSpawns?.[0]||[]),...(this.teamSpawns?.[1]||[])];for(const s of pool){const sx=Array.isArray(s)?s[0]:s?.x,sz=Array.isArray(s)?s[1]:s?.z;if(!Number.isFinite(sx)||!Number.isFinite(sz))continue;const sy=floorAt(sx,sz,this.arena);if(sy!==null&&!obstructed(sx,sy,sz,RULES.radius,this.arena)){chosen=v(sx,sy,sz);break;}}}}
  if(!finitePoint(chosen)||floorAt(chosen.x,chosen.z,this.arena)===null||obstructed(chosen.x,chosen.y,chosen.z,RULES.radius,this.arena)){const bx=Number.isFinite(chosen.x)?chosen.x:this.center.x,bz=Number.isFinite(chosen.z)?chosen.z:this.center.z;let spot=null;for(let ring=1;ring<=10&&!spot;ring++)for(let i=0;i<8&&!spot;i++){const ang=i/8*Math.PI*2,x=bx+Math.cos(ang)*ring*1.25,z=bz+Math.sin(ang)*ring*1.25,y=floorAt(x,z,this.arena);if(y!==null&&!obstructed(x,y,z,RULES.radius,this.arena))spot=v(x,y,z);}chosen=spot||v(this.center.x,floorAt(this.center.x,this.center.z,this.arena)??0,this.center.z);}
  const stats=CHARACTERS.find(c=>c.id===a.character).stats,gear=a.gear||{},maxHealth=stats.health+(gear.health||0),spawnArmor=Math.max(0,stats.armor+(gear.armor||0));
      Object.assign(a,{...chosen,lastValid:{...chosen},vx:0,vy:0,vz:0,health:maxHealth,maxHealth,armor:spawnArmor,moveSpeed:stats.speed,gearSpeed:gear.speed??1,gearDamage:gear.damage??1,gearSpread:gear.spread??1,dead:0,streak:0,weapon:modeWeapon(this.config)??(this.config.mode==='arsenal'?0:this.config.startingWeapon),ammo:spawnInventory(this.config),cooldown:0,active:0,slow:0,slowMultiplier:.55,shotWait:.25,grenadeCooldown:0,protection:RULES.protection,grounded:true,jumpBuffer:0,coyote:0,spread:0,punchYaw:0,punchPitch:0,punchVelYaw:0,punchVelPitch:0,reloading:false,reloadTimer:0,reloadDuration:0,reloadWeapon:-1,melee:0,weaponSwitch:0,burst:0,burstTimer:0,burstLeft:0,sprinting:false,crouching:false,sliding:false,slideTimer:0,slideCooldown:0,eyeHeight:MOVE.eyeStanding,baseHeight:MOVE.baseHeight,ads:false,jumpHeld:false,jumpCutArmed:false,traversalFlight:false,traversalTarget:null,zipRide:null,traversalCooldown:0,traversalPad:null,traversalEvent:null,yaw:Math.atan2(chosen.x,chosen.z),pitch:0,powerups:{},speedMultiplier:1,damageMultiplier:1,cooldownMultiplier:1,temporaryShield:0,activeSpeedMultiplier:1});applyHarnessProfile(a);a.bodyYaw=a.yaw;if(this.config.randomLoadout===true&&modeWeapon(this.config)===null){a.weapon=Math.floor(this.random()*WEAPONS.length);const w=WEAPONS[a.weapon];if(w)a.ammo[a.weapon]=this.config.unlimitedAmmo?Infinity:Math.max(a.ammo[a.weapon]||0,w.ammo);}if(this.config.mode==='armsrace'){const rung=Math.max(0,Math.min(WEAPONS.length-1,a.ladder??0));a.weapon=rung;const rw=WEAPONS[rung];if(rw&&!this.config.unlimitedAmmo)a.ammo[rung]=Math.max(a.ammo[rung]||0,rw.ammo);}
    if(a.bot)a.bot={route:[],think:0,target:-1,memory:0,reaction:0,stuck:0,last:v(a.x,a.y,a.z),state:'roam',patrol:0,flank:null,flankDone:false,recover:0,suppressed:0,threat:-1,standoff:null,strafeReverse:-99};this.stats.respawns++;this.emit('spawn',{actor:a.id,pos:v(a.x,a.y+1,a.z)});}
    damage(target,amount,source){if(this.race||this.over||target.health<=0||target.protection>0)return 0;const guardrail=target.active>0&&target.harness==='claudecode'?.5:0,mitigation=Math.min(.5,Math.max(target.harnessResistance||0,guardrail));let damage=((this.config.mode==='instagib'||this.config.oneShot===true)?10000:amount*this.config.damage)*(source?.damageMultiplier||1)*(1-mitigation)*(this.config.berserk===true&&(source?.streak||0)>=3?1.2:1);const shield=Math.min(target.temporaryShield||0,damage);target.temporaryShield-=shield;damage-=shield;const absorb=Math.min(Math.max(0,target.armor),damage*.6);target.armor-=absorb;damage-=absorb;const healthBefore=target.health,actual=Math.min(target.health,damage);target.health=Math.max(0,target.health-damage);
  // A bot that is shot registers the attacker as a remembered threat and re-plans
  // next tick, so it returns fire or investigates the last-known position instead
  // of ignoring an unseen attacker.
  if(target.bot&&source&&source!==target){target.bot.memory=Math.max(target.bot.memory||0,1.5);target.bot.seen={x:source.x,y:source.y,z:source.z};target.bot.target=source.id;target.bot.threat=source.id;target.bot.suppressed=1.4;target.bot.strafeReverse=this.time;target.bot.think=Math.min(Number.isFinite(target.bot.think)?target.bot.think:0,.06);}
  if(this.config.lifeSteal&&source&&source!==target&&source.health>0)source.health=Math.min(source.maxHealth,source.health+actual*.25);this.emit('damage',{actor:target.id,source:source?.id,amount:shield+absorb+actual,shield:shield});
    if(target.health<=0){if(target.vehicleId!==null)this.releaseVehicle(target,undefined,'destroyed');const victimStreak=target.streak||0;target.deaths++;target.streak=0;target.zipRide=null;target.traversalFlight=false;target.traversalTarget=null;target.dead=this.config.respawn;target.active=0;target.cooldown=0;target.slow=0;target.vx=target.vy=target.vz=0;this.dropFlag(target);if(source)source.frags+=source.id===target.id?-1:1;if(source&&source!==target&&source.health>0)this.applyKillstreak(source);if(this.config.mode==='armsrace'&&source&&source!==target&&source.health>0)this.advanceLadder(source);if(this.config.bounty===true&&source&&source!==target&&source.health>0&&victimStreak>=3){source.health=Math.min(source.maxHealth,source.health+30);source.frags+=1;this.emit('bounty',{actor:source.id,victim:target.id,streak:victimStreak});}if(source&&source!==target)this.stats.kills++;const weapon=Number.isInteger(source?.weapon)?source.weapon:null,overkill=Math.max(0,damage-healthBefore),direction=source&&source!==target?norm(v(target.x-source.x,0,target.z-source.z)):null,seed=(target.id*7+target.deaths*13+(source?.id??0)*29+(weapon??0)*3)>>>0,plan=deathPlan({weapon,overkill,seed});this.emit('death',{actor:target.id,pos:v(target.x,target.y+1,target.z),character:target.character,killer:source?.id??null,killerName:source?.name??null,self:source?.id===target.id,weapon,overkill,direction,seed,style:plan.style});this.feed.unshift({killer:source?.name||'Arena',victim:target.name,self:source?.id===target.id,time:this.time,weapon:weapon??null});this.feed.length=Math.min(this.feed.length,5);if(this.config.mode==='teamdeathmatch'&&source&&source!==target){this.teamScores[source.team]++;if(this.teamScores[source.team]>=this.config.fragLimit)this.endMatch('frag');}if(!teamMode(this.config)&&modeRule(this.config.mode).score==='frags'&&source?.frags>=this.config.fragLimit)this.endMatch('frag');}return shield+absorb+actual;}
     dropFlag(a,pos=a){if(this.config.mode!=='ctf')return;for(const f of Object.values(this.flags))if(f.carrier===a.id){
      // A flag rests directly below its drop point, never on a nearby or overhead roof.
      const ceiling=pos.y+1e-6,floor=floorAt(pos.x,pos.z,this.arena);let y=floor!==null&&floor<=ceiling?floor:null;
      for(const surface of surfacesOf(this.arena))if(Math.abs(pos.x-surface.x)<=surface.w/2&&Math.abs(pos.z-surface.z)<=surface.d/2&&surfaceY(surface)<=ceiling)y=Math.max(y??-Infinity,surfaceY(surface));
      for(const b of this.arena.blocks)if(Math.abs(pos.x-b.x)<=b.w/2&&Math.abs(pos.z-b.z)<=b.d/2&&b.h<=ceiling)y=Math.max(y??-Infinity,b.h);
      // Over the void nothing supports the flag; fall back to the carrier's last
      // grounded spot, or reset it to base, so the flag is always reachable.
      if(y===null){const last=a.lastValid;if(last&&Number.isFinite(last.x)&&Number.isFinite(last.z)&&floorAt(last.x,last.z,this.arena)!==null){f.x=last.x;f.y=floorAt(last.x,last.z,this.arena);f.z=last.z;f.state='dropped';}else{const base=this.flagSpawns[f.team]||[0,0];f.x=base[0];f.y=floorAt(base[0],base[1],this.arena)??0;f.z=base[1];f.state='at-base';}}
      else{f.x=pos.x;f.y=y;f.z=pos.z;f.state='dropped';}
      f.carrier=null;a.scoreStats.flagDrops++;this.emit('flag-drop',{actor:a.id,team:f.team,pos:{x:f.x,y:f.y,z:f.z}});
     }}
    fall(a){if(a.health<=0)return;if(a.vehicleId!==null)this.releaseVehicle(a,undefined,'fall');const pos=a.lastValid?{...a.lastValid}:{x:a.x,y:a.y,z:a.z};this.dropFlag(a,pos);a.health=0;a.deaths++;a.streak=0;a.dead=this.config.respawn;a.active=0;a.cooldown=0;a.slow=0;a.vx=a.vy=a.vz=0;a.traversalFlight=false;a.traversalTarget=null;a.zipRide=null;Object.assign(a,pos);this.stats.falls++;this.emit('fall',{actor:a.id,pos:{...pos},route:a.bot?.state});const seed=(a.id*7+a.deaths*13)>>>0,plan=deathPlan({fall:true,seed});this.emit('death',{actor:a.id,pos:v(pos.x,pos.y+1,pos.z),character:a.character,fall:true,weapon:null,overkill:0,direction:null,seed,style:plan.style});this.feed.unshift({killer:'The void',victim:a.name,self:true,time:this.time,weapon:null});this.feed.length=Math.min(this.feed.length,5);}
     objective(a){if(this.config.mode!=='ctf'||a.health<=0||a.vehicleId!==null)return;const home=this.flags[a.team],homeWasHome=home.state==='at-base';for(const f of Object.values(this.flags)){if(f.carrier!==null){const carrier=this.actors.find(t=>t.id===f.carrier);if(carrier){f.x=carrier.x;f.y=carrier.y;f.z=carrier.z;}}if(Math.hypot(a.x-f.x,a.z-f.z)<1.15&&Math.abs(a.y-f.y)<1.15){if(f.team===a.team){if(f.state==='dropped'){f.state='at-base';const s=this.flagSpawns[f.team];f.x=s[0];f.y=floorAt(s[0],s[1],this.arena)??0;f.z=s[1];a.scoreStats.flagReturns++;this.emit('flag-return',{actor:a.id,team:f.team,pos:{x:f.x,y:f.y,z:f.z}});}}else if(f.state!=='carried'){f.state='carried';f.carrier=a.id;f.x=a.x;f.y=a.y;f.z=a.z;a.scoreStats.flagPickups++;this.emit('flag-pickup',{actor:a.id,team:f.team});}}}
     const enemy=Object.values(this.flags).find(f=>f.carrier===a.id);if(enemy&&Math.hypot(a.x-home.x,a.z-home.z)<1.3&&Math.abs(a.y-home.y)<1.3&&homeWasHome){this.teamScores[a.team]++;a.scoreStats.captures++;enemy.state='at-base';enemy.carrier=null;const s=this.flagSpawns[enemy.team];enemy.x=s[0];enemy.y=floorAt(s[0],s[1],this.arena)??0;enemy.z=s[1];this.emit('capture',{actor:a.id,team:a.team,score:this.teamScores[a.team]});if(this.teamScores[a.team]>=this.config.fragLimit)this.endMatch('capture');}
   }
     updateAssault(dt){return objectives.updateAssault(this,dt);}
    updatePayload(dt){return objectives.updatePayload(this,dt);}
    updateObjectives(dt=RULES.dt){return objectives.updateObjectives(this,dt);}
    power(a){if(this.race||this.over||a.health<=0||a.cooldown>0||this.config.mode==='instagib')return false;const h=HARNESSES.find(h=>h.id===a.harness),ability=harnessAbility(a.harness)||h;a.protection=0;a.cooldown=(ability.cooldown??h.cooldown)*(this.config.fastPowers?.5:1)*a.cooldownMultiplier;a.active=ability.duration??h.duration;a.activeSpeedMultiplier=ability.speed??h.magnitude??1;this.stats.powers++;this.emit('power',{actor:a.id,harness:a.harness,pos:eye(a),duration:a.active});
   if(a.harness==='codex')a.health=Math.min(a.maxHealth,a.health+(ability.heal??h.magnitude));
   if(a.harness==='cline'){const dir=aim(a.yaw,0),from={...a},bounds=boundsOf(this.arena),distance=ability.distance??h.magnitude;for(let step=.12;step<=distance;step+=.12){const x=from.x+dir.x*step,z=from.z+dir.z*step,y=floorAt(x,z,this.arena);if(y===null||x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ||obstructed(x,Math.max(a.y,y),z,.48,this.arena)||y-a.y>.25)break;a.x=x;a.z=z;a.y=Math.max(a.y,y);}a.vx=a.vz=0;this.emit('dash',{from:eye(from),to:eye(a),actor:a.id});}
  if(a.harness==='roo'){const range=ability.radius??ability.range??h.range,slow=ability.slow??h.magnitude;for(const b of this.actors)if(b!==a&&b.health>0&&!b.protection&&(!teamMode(this.config)||b.team!==a.team)&&dist(a,b)<range&&this.visible(eye(a),eye(b))){b.slow=ability.duration??h.duration;b.slowMultiplier=slow;this.emit('jam',{actor:b.id,pos:eye(b)});}}
   if(a.harness==='openclaw'){const range=ability.radius??h.range,damage=ability.damage??h.damage,knockback=ability.knockback??h.magnitude,lift=ability.lift??4;for(const b of this.actors){const d=dist(a,b);if(b!==a&&b.health>0&&(!teamMode(this.config)||b.team!==a.team)&&d<range&&this.visible(eye(a),eye(b))){this.damage(b,damage,a);const dir=norm(v(b.x-a.x,0,b.z-a.z));b.vx+=dir.x*knockback;b.vz+=dir.z*knockback;b.vy+=lift;}}}return true;}
   startReload(a,weapon=a.weapon){
    const base=WEAPONS[weapon];if(!base)return false;
    const w=this.weaponForIndex(a,weapon),reload=w.reload,cap=w.cap;
    if(!(reload>0)||!Number.isFinite(reload)||!Number.isFinite(cap))return false;
    if(a.reloading||(a.ammo[weapon]??0)>=cap)return false;
    a.reloading=true;a.reloadTimer=reload;a.reloadDuration=reload;a.reloadWeapon=weapon;a.reloadCap=cap;a.reloadAmount=Number.isFinite(w.ammo)?w.ammo:0;
    this.emit('reload',{actor:a.id,weapon,state:'start',duration:reload});
    return true;
   }
    weaponForIndex(a,index){const weapon=Number.isInteger(index)?index:a.weapon,base=WEAPONS[weapon]||WEAPONS[0];if(!a.attachments?.items?.length)return base;if(a._attachmentWeapon===weapon&&a._attachmentRef===a.attachments)return a._attachmentWeapon_;const fitting=a.attachments.items.filter(item=>item.weapons.length===0||item.weapons.includes(weapon)).map(item=>item.id),w=applyAttachmentsToWeapon(base,resolveAttachments(fitting));a._attachmentWeapon=weapon;a._attachmentRef=a.attachments;a._attachmentWeapon_=w;return w;}
   weaponFor(a){return this.weaponForIndex(a,a.weapon);}
   detonate(pos,radius,damage,source){if(!(radius>0)||!finitePoint(pos))return;const blast={x:pos.x,y:pos.y+.35,z:pos.z};for(const a of this.actors){if(a.health<=0||a===source)continue;if(teamMode(this.config)&&source&&a.team===source.team)continue;const p=eye(a),d=dist(pos,p);if(d<radius&&(d<radius*.6||this.visible(blast,p)))this.damage(a,damage*(1-d/radius),source);}for(const vehicle of this.vehicles){if(vehicle.health<=0||vehicleMounted(vehicle,source?.id))continue;const d=Math.hypot(vehicle.position.x-pos.x,vehicle.position.z-pos.z);if(d<radius&&(d<radius*.6||this.visible(blast,vehicle.position))&&!this.vehicleFriendlyFire(vehicle,source))this.damageVehicle(vehicle,damage*(1-d/radius),source);}this.emit('explosion',{pos:{x:pos.x,y:pos.y,z:pos.z}});}
   pierceAlong(from,direction,maxRange,first,w,affinityDamage,source){let remaining=Math.max(0,Math.round(w.pierce));const hit=new Set([first.id]);while(remaining-- > 0){let next=null,range=maxRange;for(const b of this.actors)if(!hit.has(b.id)&&b!==source&&b.health>0&&(!teamMode(this.config)||b.team!==source.team)){const t=hitActor(from,direction,b,range);if(t!==null&&t<range){range=t;next=b;}}if(!next)break;hit.add(next.id);this.damage(next,w.damage*affinityDamage*.75,source);}}
   chainFrom(target,w,affinityDamage,source){let chained=0;for(const b of this.actors){if(chained>=w.chain)break;if(b===target||b===source||b.health<=0)continue;if(teamMode(this.config)&&source&&b.team===source.team)continue;if(dist(target,b)<=w.chainRange&&this.visible(eye(target),eye(b))){this.damage(b,w.damage*affinityDamage*.5,source);chained++;}}}
    fire(a,direction){
    if(this.race)return false;
     if(this.over||a.health<=0||a.shotWait>0||!Number.isFinite(a.shotWait)||a.reloading||(a.weaponSwitch||0)>0)return false;
     if(direction!==undefined&&!finitePoint(direction))return false;
     const locked=modeWeapon(this.config)??(this.config.mode==='armsrace'?Math.max(0,Math.min(WEAPONS.length-1,a.ladder??0)):null);if(locked!==null)a.weapon=locked;
     const attempted=Number.isInteger(a.weapon)&&a.weapon>=0&&a.weapon<WEAPONS.length?a.weapon:0;
     if(a.ammo[attempted]<=0){if(!this.startReload(a,attempted)&&attempted!==0)this.emit('dryfire',{actor:a.id,weapon:attempted});return false;}
     const w=this.weaponFor(a),weapon=a.weapon,handling=harnessWeaponHandling(a.harness,weapon)||{};let chargeScale=1;
     if(w.chargeTime>0){const fresh=this.time-(a.chargeAt??-999)>RULES.dt*1.5;a.chargeAt=this.time;if(fresh){a.charge=0;this.emit('charge',{actor:a.id,weapon,state:'start',duration:w.chargeTime});}a.charge=Math.min(w.chargeTime,(a.charge||0)+RULES.dt);if(a.charge<w.chargeTime)return false;a.charge=0;a.chargeAt=-999;chargeScale=w.chargeDamage||1;this.emit('charge',{actor:a.id,weapon,state:'ready'});}
     const affinityDamage=(handling.favored?handling.damage:1)*(a.gearDamage||1)*(a.harnessDamageMultiplier||1)*chargeScale,activeFireRate=a.active>0&&a.harness==='opencode'?(1/(handling.activeFireRate??(harnessAbility(a.harness)?.fireRate||1))):1;
     a.shotWait=w.interval*(handling.interval??1)*(a.cooldownMultiplier||1)*activeFireRate+(a.bot?this.difficulty.fireDelay:0);a.ammo[weapon]--;a.protection=0;if(w.autoBurst&&!(a.burstLeft>0))a.burstLeft=Math.max(1,(w.burst||3)-1);this.stats.shots++;a.shots++;
     const bloom=w.bloom||{base:0,perShot:0,max:0,recovery:0,moveFactor:0},recoil=w.recoil||{kick:0,recover:12,pattern:[[0,0]]},pattern=recoil.pattern||[[0,0]],burst=a.burst||0,step=pattern[burst%pattern.length]||[0,0],speedFrac=Math.min(1,Math.hypot(a.vx||0,a.vz||0)/(a.moveSpeed||RULES.speed));
     a.punchYaw=clamp((a.punchYaw||0)+step[0],-.4,.4);a.punchPitch=clamp((a.punchPitch||0)+step[1],-.4,.4);
     a.punchVelYaw=clamp((a.punchVelYaw||0)+step[0]*6,-8,8);a.punchVelPitch=clamp((a.punchVelPitch||0)+(recoil.kick||0),-8,8);
     a.burst=burst+1;a.burstTimer=.35;a.spread=Math.min(bloom.max??1,(a.spread||0)+bloom.perShot);
     let spread=(w.spread??0)+bloom.base+(a.spread||0)+bloom.moveFactor*(a.ads?.5:1)*speedFrac;
     if(a.ads)spread*=.35;if(a.sprinting)spread*=1.3;spread*=handling.spread??1;spread*=a.gearSpread??1;
     const base=aim(a.yaw+(a.punchYaw||0),a.pitch+(a.punchPitch||0));
  for(let pellet=0;pellet<(w.pellets||1);pellet++){
     const o=eye(a),d=spread>0?norm(add(base,v((this.random()-.5)*spread,(this.random()-.5)*spread,(this.random()-.5)*spread))):base;let range=this.rayWorld(o,d,w.range),target=null,vehicleTarget=null;for(const b of this.actors)if(b!==a&&b.health>0&&(!teamMode(this.config)||b.team!==a.team)){const t=hitActor(o,d,b,range);if(t!==null&&t<range){range=t;target=b;vehicleTarget=null;}}for(const vehicle of this.vehicles)if(vehicle.health>0&&!vehicleMounted(vehicle,a.id)&&!this.vehicleFriendlyFire(vehicle,a)){const t=hitVehicle(o,d,vehicle,range);if(t!==null&&t<range&&!(target&&vehicleMounted(vehicle,target.id))){range=t;target=null;vehicleTarget=vehicle;}}
  const goal=add(o,d,range),side=aim(a.yaw-Math.PI/2,0),muzzle=add(add(o,side,.24),d,.42);muzzle.y-=.24;
  const md=norm(v(muzzle.x-o.x,muzzle.y-o.y,muzzle.z-o.z)),ml=dist(o,muzzle),muzzleBlocked=this.rayWorld(o,md,ml)<ml-.01;
  if(muzzleBlocked){this.emit('shot',{actor:a.id,weapon,from:o,to:add(o,md,this.rayWorld(o,md,ml))});continue;}
  const trajectory=norm(v(goal.x-muzzle.x,goal.y-muzzle.y,goal.z-muzzle.z)),travel=dist(muzzle,goal),block=this.rayWorld(muzzle,trajectory,travel);
    if(w.speed){this.rockets.push({id:++this.serial,owner:a.id,weapon,pos:muzzle,dir:trajectory,vy:trajectory.y*w.speed,damageMultiplier:affinityDamage,life:w.life??4,bounces:0,homing:w.homing??0,homingTurnRate:w.homingTurnRate??0});this.emit('launch',{actor:a.id,weapon,pos:muzzle});}
    else{const clear=block>=travel-.1,impact=add(muzzle,trajectory,Math.min(block,travel)),falloff=damageFalloff(w,range);if(clear){if(target)this.damage(target,w.damage*affinityDamage*falloff,a);else if(vehicleTarget)this.damageVehicle(vehicleTarget,w.damage*affinityDamage*falloff,a);if(w.explosiveRadius>0)this.detonate(impact,w.explosiveRadius,w.explosiveDamage*w.damage*affinityDamage,a);if(w.pierce>0&&target){const continuation=this.rayWorld(impact,trajectory,Math.max(0,w.range-range));this.pierceAlong(impact,trajectory,continuation,target,w,affinityDamage,a);}if(w.chain>0&&target)this.chainFrom(target,w,affinityDamage,a);}this.emit('shot',{actor:a.id,weapon,from:muzzle,to:add(muzzle,trajectory,Math.min(block,travel)),hit:target?.id??vehicleTarget?.id??false,falloff});}
  }return true;}
  advanceLadder(a){const next=(a.ladder??0)+1;if(next>=WEAPONS.length){a.ladder=next;this.armsraceWinner=a.id;this.endMatch('objective');this.emit('armsrace-win',{actor:a.id});return;}a.ladder=next;a.weapon=next;const w=WEAPONS[next];a.ammo[next]=this.config.unlimitedAmmo?Infinity:w.ammo;a.weaponSwitch=.2;this.emit('armsrace-promote',{actor:a.id,weapon:next});}
    applyKillstreak(a){a.streak=(a.streak||0)+1;const reward=a.streak===3?'scavenger':a.streak===5?'overcharge':a.streak===7?'overshield':null;if(!reward)return;a.streak===3?(a.health=Math.min(a.maxHealth,a.health+20),(()=>{const w=this.weaponForIndex(a,a.weapon);if(Number.isFinite(w?.cap)&&!this.config.unlimitedAmmo)a.ammo[a.weapon]=Math.min(w.cap,(a.ammo[a.weapon]||0)+w.ammo);})()):(()=>{const p=POWERUPS.find(x=>x.id===reward);if(p){a.powerups[p.id]=p.duration;this.refreshPowerups(a);if(p.effect.armor)a.temporaryShield=p.effect.armor;}})();this.emit('killstreak',{actor:a.id,streak:a.streak,reward});}
    throwGrenade(a){if(this.over||a.health<=0||a.vehicleId!==null||(a.grenadeCooldown||0)>0)return false;const w=WEAPONS[5],flat=aim(a.yaw+(a.punchYaw||0),0),from=eye(a);this.rockets.push({id:++this.serial,owner:a.id,weapon:5,pos:from,dir:norm(v(flat.x,0,flat.z)),vy:5.5,damageMultiplier:1,life:2.6,bounces:0,homing:0,homingTurnRate:0});a.grenadeCooldown=7;this.stats.grenades=(this.stats.grenades||0)+1;this.emit('grenade',{actor:a.id,pos:from});return true;}
  melee(a){if(this.over||a.health<=0||(a.melee||0)>0)return false;a.protection=0;a.melee=MELEE.cooldown;const dir=aim(a.yaw,a.pitch),origin=eye(a);let best=null,bestD=Infinity;for(const b of this.actors){if(b===a||b.health<=0||(teamMode(this.config)&&b.team===a.team))continue;const d=dist(a,b);if(d>MELEE.range||d>=bestD)continue;const target=eye(b),to=norm(v(target.x-origin.x,target.y-origin.y,target.z-origin.z));if((to.x*dir.x+to.y*dir.y+to.z*dir.z)<MELEE.arc)continue;if(!this.visible(origin,target))continue;best=b;bestD=d;}if(best)this.damage(best,MELEE.damage,a);this.emit('melee',{actor:a.id,hit:best?.id??null,pos:origin});return true;}
     explode(r,hit){const source=this.actors[r.owner],w=WEAPONS[r.weapon??1],affinityDamage=r.damageMultiplier||1,blast={x:r.pos.x,y:(r.pos.y??0)+.35,z:r.pos.z};if(hit)this.damage(hit,w.damage*affinityDamage,source);for(const a of this.actors){const p=eye(a),d=dist(r.pos,p);if(a.health>0&&(a===source||!teamMode(this.config)||a.team!==source?.team)&&d<w.radius&&(d<w.radius*.6||this.visible(blast,p))){this.damage(a,w.splash*affinityDamage*(1-d/w.radius),source);const n=norm(v(a.x-r.pos.x,.5,a.z-r.pos.z));a.vx+=n.x*8;a.vz+=n.z*8;a.vy+=4;}}for(const vehicle of this.vehicles){const d=Math.hypot(vehicle.position.x-r.pos.x,vehicle.position.z-r.pos.z);if(vehicle.health>0&&d<w.radius&&(d<w.radius*.6||this.visible(blast,vehicle.position))&&!this.vehicleFriendlyFire(vehicle,source))this.damageVehicle(vehicle,w.splash*affinityDamage*(1-d/w.radius),source);}this.emit('explosion',{pos:{...r.pos},weapon:r.weapon??1});}
  useful(a,p){if(this.config.mode==='instagib'&&p.kind!=='health'&&p.kind!=='armor')return false;if(p.kind==='health')return a.health<a.maxHealth;if(p.kind==='armor')return a.armor<100;if(POWERUPS.some(x=>x.id===p.kind))return true;const n=pickupWeapon(p.kind);return n!==undefined&&a.ammo[n]<this.weaponForIndex(a,n).cap;}
   collect(a,p){if(!this.useful(a,p))return false;const power=POWERUPS.find(x=>x.id===p.kind);if(p.kind==='health')a.health=Math.min(a.maxHealth,a.health+35);else if(p.kind==='armor')a.armor=Math.min(100,a.armor+40);else if(power){a.powerups[power.id]=power.duration;this.refreshPowerups(a);if(power.effect.armor)a.temporaryShield=power.effect.armor;this.emit('powerup',{actor:a.id,kind:power.id,duration:a.powerups[power.id],effect:{...power.effect},pos:eye(a)});}else{const n=pickupWeapon(p.kind),w=this.weaponForIndex(a,n);a.ammo[n]=this.config.unlimitedAmmo?Infinity:Math.min(w.cap,a.ammo[n]+w.ammo);if(a.weapon===0&&this.config.mode!=='armsrace')a.weapon=n;}p.wait=p.kind==='health'||p.kind==='armor'?12:15;this.stats.pickups++;this.emit('pickup',{actor:a.id,kind:p.kind,powerup:!!power});return true;}
   refreshPowerups(a){a.speedMultiplier=1;a.damageMultiplier=1;a.cooldownMultiplier=1;for(const id of Object.keys(a.powerups)){const p=POWERUPS.find(x=>x.id===id);if(!p||a.powerups[id]<=0){delete a.powerups[id];continue;}const e=p.effect;if(e.speedMultiplier)a.speedMultiplier=Math.max(a.speedMultiplier,e.speedMultiplier);if(e.damageMultiplier)a.damageMultiplier=Math.max(a.damageMultiplier,e.damageMultiplier);if(e.cooldownMultiplier)a.cooldownMultiplier=Math.min(a.cooldownMultiplier,e.cooldownMultiplier);}}
    botInput(a,dt){return bots.botInput(this,a,dt);}
    endMatch(reason){if(!this.over){this.over=true;this.overReason=reason??null;}}
    step(dt,inputs={}){if(this.over)return;if(this.race)return this.race.kind==='soccer'?this.stepSoccer(dt,inputs):this.stepRace(dt,inputs);this.time+=dt;
  const given=inputs.inputs||{0:inputs};
  for(const p of this.pickups)p.wait=Math.max(0,p.wait-dt);
  for(const vehicle of this.vehicles){if(vehicle.respawnTimer>0){vehicle.respawnTimer=Math.max(0,vehicle.respawnTimer-dt);if(vehicle.respawnTimer===0){respawnVehicle(vehicle,vehicle.spawn,vehicle.heading);this.emit('vehicle-respawn',{vehicle:vehicle.id,pos:{...vehicle.position}});}}else if(vehicle.driver===null)stepVehicle(vehicle,{},dt);}
  for(const a of this.actors){if(this.over)break;if(a.health<=0){a.dead-=dt;if(a.dead<=0)this.spawn(a);continue;}
  a.slow=Math.max(0,(a.slow||0)-dt);a.cooldown=Math.max(0,a.cooldown-dt);a.active=Math.max(0,a.active-dt);a.shotWait=Math.max(0,a.shotWait-dt);a.grenadeCooldown=Math.max(0,(a.grenadeCooldown||0)-dt);a.protection=Math.max(0,a.protection-dt);a.weaponSwitch=Math.max(0,(a.weaponSwitch||0)-dt);a.burstTimer=Math.max(0,(a.burstTimer||0)-dt);if(a.burstTimer<=0)a.burst=0;a.melee=Math.max(0,(a.melee||0)-dt);if(a.reloading){a.reloadTimer-=dt;if(a.reloadTimer<=0){const reloadWeapon=a.reloadWeapon,w=WEAPONS[reloadWeapon],cap=a.reloadCap??w?.cap,amount=a.reloadAmount??w?.ammo??0;a.ammo[reloadWeapon]=this.config.unlimitedAmmo?Infinity:Math.min(Number.isFinite(cap)?cap:Infinity,(a.ammo[reloadWeapon]||0)+amount);a.reloading=false;a.reloadTimer=0;a.reloadDuration=0;a.reloadWeapon=-1;a.reloadCap=undefined;a.reloadAmount=undefined;this.emit('reload',{actor:a.id,weapon:reloadWeapon,state:'end'});}}const wsel=this.weaponFor(a),recoil=wsel.recoil||{kick:0,recover:12},bloom=wsel.bloom,recover=recoil.recover??12;a.punchPitch=(a.punchPitch||0)+(a.punchVelPitch||0)*dt;a.punchYaw=(a.punchYaw||0)+(a.punchVelYaw||0)*dt;a.punchVelPitch=(a.punchVelPitch||0)+(-a.punchPitch*recover*recover-(a.punchVelPitch||0)*2*recover)*dt;a.punchVelYaw=(a.punchVelYaw||0)+(-a.punchYaw*recover*recover-(a.punchVelYaw||0)*2*recover)*dt;a.punchPitch=clamp(a.punchPitch,-.4,.4);a.punchYaw=clamp(a.punchYaw,-.4,.4);a.spread=Math.max(0,(a.spread||0)-(bloom?.recovery??.1)*dt);let expired=false;for(const id of Object.keys(a.powerups)){a.powerups[id]-=dt;if(a.powerups[id]<=0){delete a.powerups[id];expired=true;}}if(expired){this.refreshPowerups(a);if(!a.powerups.overshield)a.temporaryShield=0;}
   if(a.burstLeft>0&&a.shotWait<=0&&a.health>0&&a.ammo[a.weapon]>0){this.fire(a);a.burstLeft--;const burstWeapon=this.weaponFor(a);a.shotWait=Math.min(a.shotWait||Infinity,burstWeapon.burstDelay||.12);}else if(a.ammo[a.weapon]<=0)a.burstLeft=0;
   const ext=given[a.id];
   if(ext){if(Number.isFinite(ext.yaw))a.yaw=ext.yaw;if(Number.isFinite(ext.pitch))a.pitch=Math.max(-1.45,Math.min(1.45,ext.pitch));if(this.config.mode!=='armsrace'&&Number.isInteger(ext.weapon)&&ext.weapon>=0&&ext.weapon<WEAPONS.length&&a.ammo[ext.weapon]>0&&ext.weapon!==a.weapon){a.weapon=ext.weapon;a.weaponSwitch=.45;a.reloading=false;a.reloadTimer=0;a.reloadDuration=0;a.reloadWeapon=-1;this.emit('weapon-switch',{actor:a.id,weapon:ext.weapon});}if(ext.reload)this.startReload(a,a.weapon);if(ext.melee)this.melee(a);}
  const controls=ext||(a.bot?this.botInput(a,dt):{});
     if(!ext&&controls.melee)this.melee(a);
     if(a.vehicleId!==null){if(controls.interact)this.releaseVehicle(a,undefined,'exit');else if(a.vehicleSeat==='driver')this.driveVehicle(a,controls,dt);else if(a.vehicleSeat==='gunner')this.gunnerVehicle(a,controls,dt);else{const ride=this.vehicleById(a.vehicleId);if(ride)this.syncVehicleActor(a,ride);}}
     else if(!(controls.interact&&this.enterVehicle(a)))moveActor(a,controls,dt,this.arena,this.config);const bodyTurn=(this.difficulty?.id==='nightmare'?10:this.difficulty?.id==='hard'?8:this.difficulty?.id==='normal'?6:4)*dt;const nextBody=turnToward(a.bodyYaw??a.yaw,a.yaw,bodyTurn);a.bodyYaw=Math.atan2(Math.sin(nextBody),Math.cos(nextBody));
    if(a.traversalEvent){const evt=a.traversalEvent;a.traversalEvent=null;this.emit(evt.type,{actor:a.id,id:evt.id,from:evt.from,to:evt.to});}
    if(this.arena.voidY!==undefined&&a.y<this.arena.voidY){this.fall(a);continue;}this.objective(a);if(ext&&a.vehicleId===null){if(ext.power)this.power(a);if(ext.fire)this.fire(a);if(ext.grenade)this.throwGrenade(a);}
  for(const p of this.pickups)if(!p.wait&&dist(a,p)<1.05)this.collect(a,p);
  }
  let stompOrder=null;
  for(const vehicle of this.vehicles){
   if(vehicle.health<=0||vehicle.driver===null||vehicle.config?.flight===true)continue;
   const vehicleSpeed=Math.abs(Number.isFinite(vehicle.speed)?vehicle.speed:Math.hypot(vehicle.velocity.x,vehicle.velocity.z));
   if(vehicleSpeed<=5)continue;
   const driver=this.actors.find(actor=>actor.id===vehicle.driver),radius=vehicleRadius(vehicle)*.9;if(!stompOrder)stompOrder=[...this.actors].sort((x,y)=>x.id-y.id);
   for(const target of stompOrder){
    if(target.health<=0||target.protection>0||target.vehicleId!==null)continue;
    if(driver&&teamMode(this.config)&&target.team===driver.team)continue;
    if(Math.hypot(target.x-vehicle.position.x,target.z-vehicle.position.z)>radius)continue;
    const key=`${vehicle.id}:${target.id}`;
    if((this.vehicleHits.get(key)||0)>this.time)continue;
    this.vehicleHits.set(key,this.time+.5);
    this.damage(target,25*(vehicleSpeed-5),driver);
    const dir=norm(v(target.x-vehicle.position.x,0,target.z-vehicle.position.z)),push=Math.min(14,vehicleSpeed*.7);
    target.vx+=dir.x*push;target.vz+=dir.z*push;target.vy+=4;
    this.emit('vehicle-splatter',{vehicle:vehicle.id,actor:target.id,source:driver?.id??null,speed:vehicleSpeed});
   }
  }
  const alive=this.rockets.length?[]:this.rockets;for(const r of this.rockets){const w=WEAPONS[r.weapon??1];r.life-=dt;if(r.homing>0){let target=null,best=(r.homing||0)*50;const owner=this.actors[r.owner];for(const b of this.actors)if(b.id!==r.owner&&b.health>0&&(!teamMode(this.config)||b.team!==owner?.team)){const d=dist(r.pos,eye(b));if(d<best){best=d;target=b;}}if(target){const desired=norm(v(target.x-r.pos.x,(target.y??0)+.9-r.pos.y,target.z-r.pos.z)),t=clamp((r.homingTurnRate||3)*dt,0,1);r.dir=norm(v(r.dir.x+(desired.x-r.dir.x)*t,r.dir.y+(desired.y-r.dir.y)*t,r.dir.z+(desired.z-r.dir.z)*t));if(w.gravity)r.vy=r.dir.y*w.speed;}}const velocity=w.gravity?v(r.dir.x*w.speed,(r.vy??r.dir.y*w.speed)-RULES.gravity*w.gravity*dt,r.dir.z*w.speed):v(r.dir.x*w.speed,r.dir.y*w.speed,r.dir.z*w.speed);if(w.gravity)r.vy=velocity.y;const travel=Math.hypot(velocity.x,velocity.y,velocity.z)*dt,direction=norm(velocity);let range=this.rayWorld(r.pos,direction,travel),hit=null,hitVehicleRef=null;for(const a of this.actors)if(a.id!==r.owner&&a.health>0&&(!teamMode(this.config)||a.team!==this.actors[r.owner]?.team)){const t=hitActor(r.pos,direction,a,range);if(t!==null&&t<range){range=t;hit=a;hitVehicleRef=null;}}for(const vehicle of this.vehicles)if(vehicle.health>0&&!vehicleMounted(vehicle,r.owner)&&!this.vehicleFriendlyFire(vehicle,this.actors[r.owner])){const t=hitVehicle(r.pos,direction,vehicle,range);if(t!==null&&t<range){range=t;hit=null;hitVehicleRef=vehicle;}}
    const impact=add(r.pos,direction,range<travel?Math.max(0,range-.025):travel),floor=floorAt(impact.x,impact.z,this.arena);r.pos=impact;if(range<travel&&!hit&&!hitVehicleRef&&w.bounce>0&&r.bounces<3&&floor!==null&&impact.y<=floor+.08){r.vy=Math.abs(r.vy)*w.bounce;r.bounces++;alive.push(r);}else if(range<travel||r.life<=0){if(hitVehicleRef)this.damageVehicle(hitVehicleRef,w.damage*(r.damageMultiplier||1),this.actors[r.owner]);this.explode(r,hit);}else alive.push(r);}
    this.rockets=alive;this.updateObjectives(dt);this.updateSinglePlayer(dt);
    // Arms Race is ladder-ranked: promotions outrank raw frags everywhere, so a
    // lower-rung player can never be handed the match on a frag tie-break.
    const ffaLeaders=()=>{if(this.config.mode==='armsrace'){const top=Math.max(...this.actors.map(a=>a.ladder??0)),cascade=this.actors.filter(a=>(a.ladder??0)===top),max=Math.max(...cascade.map(a=>a.frags));return cascade.filter(a=>a.frags===max);}const max=Math.max(...this.actors.map(a=>a.frags));return this.actors.filter(a=>a.frags===max);};
    const tiedAtLimit=()=>teamMode(this.config)?this.teamScores[0]===this.teamScores[1]:ffaLeaders().length>1;
    const decidedAfterTie=()=>teamMode(this.config)?this.teamScores[0]!==this.teamScores[1]:ffaLeaders().length===1;
    if(this.time>=this.config.timeLimit&&!this.over){
     const suddenCapable=this.config.suddenDeath===true&&this.config.mode!=='assault'&&this.config.mode!=='payload'&&this.config.mode!=='armsrace';
    if(!this.suddenDeath&&suddenCapable&&tiedAtLimit()){this.suddenDeath=true;this.emit('sudden-death',{time:this.time});}
    else if(!this.suddenDeath){this.endMatch('time');if(this.objectiveState?.kind==='assault'&&!this.objectiveState.breached){this.objectiveState.winner=this.objectiveState.defender??1;this.emit('assault-hold',{winner:this.objectiveState.winner});}if(this.objectiveState?.kind==='payload'&&!this.objectiveState.delivered){this.objectiveState.winner=this.objectiveState.defender??1;this.emit('payload-hold',{winner:this.objectiveState.winner});}}
   }
   if(this.suddenDeath&&!this.over){if(decidedAfterTie())this.endMatch('sudden-death');else if(this.time>=this.config.timeLimit+60)this.endMatch('time');}}
  leaders(){if(this.modeState&&this.modeState.kind)return this.actors.filter(a=>a.id===this.modeState.playerId);if(this.race){if(this.race.kind==='soccer'){const id=soccerStandings(this.race)[0]?.actorId;return this.actors.filter(a=>a.id===id);}const id=this.race.winnerId??raceStandings(this.race)[0]?.actorId;return this.actors.filter(a=>a.id===id);}if(teamMode(this.config)){const max=Math.max(...Object.values(this.teamScores));return this.actors.filter(a=>this.teamScores[a.team]===max);}if(this.config.mode==='armsrace'&&this.armsraceWinner!==null&&this.armsraceWinner!==undefined)return this.actors.filter(a=>a.id===this.armsraceWinner);return rankLeaders(this.actors,this.config.mode);}
     snapshot(){const mode=GAME_MODES.find(m=>m.id===this.config.mode),leaders=this.leaders(),objective=this.config.mode==='ctf'?{nodes:this.arena.objectiveNodes||[],flags:Object.values(this.flags).map(f=>({...f})),winner:null,leaders:[...new Set(leaders.map(a=>a.team))]}:this.objectiveState?{kind:this.objectiveState.kind,zones:this.objectiveState.zones.map(z=>({...z})),active:this.objectiveState.active,attacker:this.objectiveState.attacker,defender:this.objectiveState.defender,breached:this.objectiveState.breached,winner:this.objectiveState.winner,leaders:[...new Set(leaders.map(a=>a.team))],...(this.objectiveState.kind==='payload'?{payload:{position:{...(this.objectiveState.position||payloadPosition(this.objectiveState))},distance:this.objectiveState.distance,total:this.objectiveState.total,speed:this.objectiveState.speed,radius:this.objectiveState.radius,pushing:this.objectiveState.pushing,contested:this.objectiveState.contested,delivered:this.objectiveState.delivered,checkpointsReached:this.objectiveState.checkpointsReached,checkpointCount:this.objectiveState.checkpoints.length,progress:payloadProgress(this.objectiveState)}}:{})}:null,teamMax=Math.max(...Object.values(this.teamScores)),winningTeams=[0,1].filter(team=>this.teamScores[team]===teamMax);return {
      ...(this.race?{race:this.race.kind==='soccer'?soccerSnapshot(this.race):raceSnapshot(this.race)}:{}),
      config:{...this.config},modeName:mode.name,mapId:this.arena.id,mapName:this.arena.name,time:this.time,over:this.over,overReason:this.overReason??null,suddenDeath:this.suddenDeath===true,feed:this.feed.map(f=>({...f})),actors:this.actors.slice().sort((a,b)=>a.id-b.id).map(a=>({...a,scoreStats:{...a.scoreStats},bot:a.bot?{state:a.bot.state,route:[...a.bot.route]}:null,ammo:a.ammo.map(n=>Number.isFinite(n)?n:'∞')})),vehicles:this.vehicles.map(vehicle=>({id:vehicle.id,kind:vehicle.kind,x:vehicle.position.x,y:vehicle.position.y,z:vehicle.position.z,vx:vehicle.velocity.x,vy:vehicle.vy??0,vz:vehicle.velocity.z,yaw:vehicle.heading,roll:vehicle.roll,pitchBody:vehicle.pitchBody,flight:vehicle.config?.flight===true,altitude:vehicle.position.y,turretYaw:vehicle.turretYaw,health:vehicle.health,maxHealth:vehicle.maxHealth,driver:vehicle.driver,gunner:vehicle.gunner,passengers:[...(vehicle.passengers||[])],heat:vehicle.heat,overheated:vehicle.overheated,respawnTimer:vehicle.respawnTimer})),pickups:this.pickups.map(p=>({...p})),flags:Object.values(this.flags).map(f=>({...f})),teamScores:{0:this.teamScores[0],1:this.teamScores[1]},
      winner:this.race?(this.race.kind==='soccer'?this.race.winnerTeam:this.race.winnerId):(this.config.mode==='armsrace'&&this.armsraceWinner!==null&&this.armsraceWinner!==undefined?this.armsraceWinner:objective?.winner??(this.over&&teamMode(this.config)&&winningTeams.length===1?winningTeams[0]:null)),objectives:objective,projectiles:this.rockets.length,rockets:this.rockets.map(r=>({...r,pos:{...r.pos}})),stats:{...this.stats},leaders:leaders.map(a=>a.name),singleplayer:this.modeState?singlePlayerSnapshot(this.modeState,this):null};}
}
