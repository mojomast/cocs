import {modeRule} from './config.mjs';
import {terrainSupportAt} from './terrain.mjs';
import {assaultTemplate,assignAssaultTeams,assaultSectorIds} from './assault.mjs';
import {payloadTemplate} from './payload.mjs';
const point=(x,z,id,rules,radius=3.5,y=0)=>({id,x,z,radius,owner:null,captureTeam:null,progress:0,captureSeconds:rules.objective?.captureSeconds??5,y});
const boundsOf=arena=>arena.bounds||{minX:-13.55,maxX:13.55,minZ:-13.55,maxZ:13.55};

// Keep capture centers on walkable ground. These maps predate objective metadata,
// so their bounds centers can be inside a reactor, cover, or island landmark.
const authoredObjectivePoints={
  exchange:[[-11,-12,1.5,3.8],[0,-12,1.5,3.8],[11,-12,1.5,3.8]],
  crosswire:[[-9,0,3.5,0],[0,-9,3.5,0],[9,0,3.5,0]],
  foundry:[[-10,0,3.5,0.95],[0,-9,3.5,3.8],[10,0,3.5,0.95]],
  launchpad:[[-18,0,3.5,0],[0,8,3.5,0],[18,0,3.5,0]],
  citadel:[[-12,0,3.5,0],[0,-9,3.5,0],[12,0,3.5,0]],
  'blood-gulch':[[-20,0,3.5,0],[0,0,3.5,0],[20,0,3.5,0]],
  skybreak:[[-21,-18,3.5,0],[0,3,2,0],[21,18,3.5,0]],
  aether:[[-17,-18,2,0],[0,3,2,0],[17,18,2,0]],
  'sunscar-canyon':[[-28,0,3.5,0],[0,-7,3.5,0],[28,0,3.5,0]],
  'ironfall-megastructure':[[-43,-8,3.5,0],[0,0,3.5,0],[43,8,3.5,0]],
  'longreach-plateau':[[-52,-10,3.5,0],[0,0,3.5,0],[52,10,3.5,0]],
};
const terrainHeight=(arena,x,z)=>{if(!arena.terrain)return null;const support=terrainSupportAt(x,z,arena.terrain,arena.terrain.maxSlope??.9);return support?support.y:null;};
const toPoints=(values,ids,rules,arena)=>{if(!Array.isArray(values)||values.length<ids.length)return null;return values.map(([x,z,radius,y=0],i)=>{if(!Number.isFinite(x)||!Number.isFinite(z))return null;const ground=arena?terrainHeight(arena,x,z):null;return point(x,z,ids[i],rules,radius,ground===null?y:ground);}).filter(Boolean);};
const obstructedByBlocks=(arena,x,z,y,radius)=> (arena.blocks||[]).some(block=>Math.abs(x-block.x)<block.w/2+radius&&Math.abs(z-block.z)<block.d/2+radius&&y<block.h-1e-6);
const onPlatform=(arena,x,z,radius)=> (arena.platforms||[]).some(platform=>Math.abs(x-platform.x)<=platform.w/2-radius&&Math.abs(z-platform.z)<=platform.d/2-radius);
const spreadPoints=(pool,count)=>{
  const distinct=pool.filter((candidate,index)=>pool.findIndex(other=>other.x===candidate.x&&other.z===candidate.z)===index);
  if(distinct.length<=count)return distinct;
  const chosen=[distinct[0]];
  while(chosen.length<count){
    let best=null,bestDistance=-1;
    for(const candidate of distinct){
      if(chosen.includes(candidate))continue;
      let nearest=Infinity;
      for(const point of chosen)nearest=Math.min(nearest,Math.hypot(candidate.x-point.x,candidate.z-point.z));
      if(nearest>bestDistance){bestDistance=nearest;best=candidate;}
    }
    if(!best)break;
    chosen.push(best);
  }
  return chosen;
};
const candidatePoints=(arena,ids,rules)=>{
  const b=boundsOf(arena),radius=3.5;
  const candidates=[...(arena.navNodes||[]),...(arena.spawns||[]).map(([x,z])=>({x,z,y:0})),...(arena.pickups||[]).map(([,x,z])=>({x,z,y:0}))];
  if(!arena.terrain)candidates.push({x:b.minX+(b.maxX-b.minX)*.25,z:b.minZ+(b.maxZ-b.minZ)*.25,y:0},{x:b.maxX-(b.maxX-b.minX)*.25,z:b.maxZ-(b.maxZ-b.minZ)*.25,y:0});
  const safe=candidates.filter(candidate=>Number.isFinite(candidate.x)&&Number.isFinite(candidate.z)&&(!arena.platforms?.length||onPlatform(arena,candidate.x,candidate.z,radius))&&!obstructedByBlocks(arena,candidate.x,candidate.z,candidate.y??0,radius));
  const spread=spreadPoints(safe,ids.length);
  return ids.map((id,index)=>{const candidate=spread[index]||{x:b.minX+(b.maxX-b.minX)/2,z:b.minZ+(b.maxZ-b.minZ)/2,y:0};return point(candidate.x,candidate.z,id,rules,radius,candidate.y??0);});
};
// Capture points must sit on ground an actor can actually stand on. Next-gen
// maps put some centres on solid bridge/catwalk decks with no step-up, so nudge
// any obstructed zone to the nearest clear ground within the map.
const clearZone=(arena,zone)=>{
  if(!arena.terrain)return zone;
  const radius=.6;
  const clearAt=(x,z)=>{const ground=terrainHeight(arena,x,z);return ground===null||obstructedByBlocks(arena,x,z,ground,radius)?null:ground;};
  const center=clearAt(zone.x,zone.z);
  if(center!==null)return {...zone,y:center};
  let best=null,bestDistance=Infinity;
  for(let r=.5;r<=20;r+=.5)for(let a=0;a<48;a++){
    const angle=a/48*Math.PI*2,nx=zone.x+Math.cos(angle)*r,nz=zone.z+Math.sin(angle)*r;
    if(!Number.isFinite(nx)||!Number.isFinite(nz))continue;
    const ground=clearAt(nx,nz);
    if(ground===null)continue;
    const distance=Math.hypot(nx-zone.x,nz-zone.z);
    if(distance<bestDistance){bestDistance=distance;best={...zone,x:nx,z:nz,y:ground};}
  }
  return best||zone;
};
const authoredPoints=(arena,ids,rules)=>{
  const authored=toPoints(authoredObjectivePoints[arena.id],ids,rules,arena);
  if(authored&&authored.length>=ids.length)return authored;
  if(Array.isArray(arena.objectiveZones)&&arena.objectiveZones.length>=ids.length){
    const mapped=ids.map((id,index)=>{const source=arena.objectiveZones[index];if(!source||!Number.isFinite(source.x)||!Number.isFinite(source.z))return null;return point(source.x,source.z,id,rules,source.radius??3.5,source.y??0);}).filter(Boolean);
    if(mapped.length>=ids.length)return mapped;
  }
  return candidatePoints(arena,ids,rules);
};
export function objectiveTemplate(mode,arena,config){
 const rules=modeRule(mode),kind=rules.objective?.kind,authored=authoredPoints(arena,['alpha','bravo','charlie'],rules);
 if(kind==='koth'){
  const b=boundsOf(arena),centerX=(b.minX+b.maxX)/2,centerZ=(b.minZ+b.maxZ)/2;
  const source=arena.id==='crosswire'?authored[1]:authored.slice().sort((p,q)=>Math.hypot(p.x-centerX,p.z-centerZ)-Math.hypot(q.x-centerX,q.z-centerZ))[0];
  return {kind:'koth',zones:[clearZone(arena,{...source,id:'hill',captureSeconds:rules.objective.captureSeconds})],winner:null};
 }
 if(kind==='domination')return {kind:'domination',zones:authored.map(zone=>clearZone(arena,zone)),winner:null};
 if(kind==='assault'){const count=config?.fragLimit??rules.fragLimit??3;const template=assaultTemplate(arena,assaultSectorIds(count));template.zones=template.sectors;return assignAssaultTeams(template);}
 if(kind==='payload')return payloadTemplate(arena,{segments:Math.max(1,Math.min(6,Math.round(config?.fragLimit??rules.fragLimit??3)))});
 if(kind==='elimination'){const lives=Math.max(1,Math.round(config?.fragLimit??rules.fragLimit??20));return {kind:'elimination',zones:authored.map(zone=>clearZone(arena,zone)),winner:null,livesPerTeam:lives,lives:{0:lives,1:lives},deaths:{0:0,1:0},eliminations:{0:0,1:0},suddenDeath:false};}
 if(kind==='juggernaut')return {kind:'juggernaut',zones:authored.map(zone=>clearZone(arena,zone)),winner:null,juggernautId:0,points:{},suddenDeath:false};
 if(kind==='extraction'){
  // The escort starts on the first authored point and runs to the last; the
  // midpoint doubles as a contested waypoint the HUD and bots can read.
  const points=authored.map(zone=>clearZone(arena,zone)),spawn=points[0],extract=points[points.length-1];
  return {kind:'extraction',zones:points,spawn:{x:spawn.x,y:spawn.y,z:spawn.z},extract:{x:extract.x,y:extract.y,z:extract.z},escortTeam:0,defenderTeam:1,captureSeconds:rules.objective?.captureSeconds??4,escortRadius:rules.objective?.escortRadius??7,speed:rules.objective?.escortSpeed??4,progress:0,vipId:null,vipDead:false,winner:null};
 }
 return null;
}
