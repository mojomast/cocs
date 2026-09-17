export const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const wall=(x,z,w,d,h=9,kind='wall')=>({x,z,w,d,h,kind});
export const cover=(x,z,w=3,d=2,h=2,kind='cover')=>({x,z,w,d,h,kind});
export const coverBuilder=({h:height=2}={})=>((x,z,w=3,d=2,h=height,kind='cover')=>({x,z,w,d,h,kind}));
export const platform=(x,z,w,d,route,y=0)=>({x,z,w,d,y,thickness:.7,kind:'platform',route});
export const pad=(id,x,z,power=18)=>({id,x,z,y:0,power,cooldown:2});
export const tp=(id,x,z,tx,tz,y=0,ty=0)=>({id,x,z,y,target:{x:tx,y:ty,z:tz},cooldown:1});
export const teleporter=({to,target,...rest})=>({...rest,target:target??to});
export const zone=(x,z,radius=3.5,label)=>(label===undefined?{x,z,y:0,radius}:{x,z,y:0,radius,label});
export const teamSpawns=(west,east)=>({0:west,1:east,red:west,blue:east});
export const teamData=teamSpawns;
export const flagSpawns=(west,east)=>({0:{x:west,z:0},1:{x:east,z:0},red:{x:west,z:0},blue:{x:east,z:0}});
export const flagData=flagSpawns;

// ---- Schema validation ----------------------------------------------------
//
// A structural pass over the map contract the simulation consumes. It is pure
// and three.js-free, so levelgen, map packs and tests can all share it. The
// validator reports *errors* (degenerate/unsafe data) separately from
// *warnings* (suspicious but playable), and never throws on its own.
export const LEVELGEN_SCHEMA_VERSION=2;
export const REQUIRED_MAP_ARRAYS=Object.freeze(['blocks','spawns','pickups','navNodes']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const pointPair=value=>Array.isArray(value)&&finite(value[0])&&finite(value[1]);
const pointObject=value=>Boolean(value)&&finite(value.x)&&finite(value.z);
const inBounds=(bounds,x,z)=>x>=bounds.minX&&x<=bounds.maxX&&z>=bounds.minZ&&z<=bounds.maxZ;

/** Structural schema errors for a map template. Returns [] when valid. */
export function validateMapSchema(map){
 const errors=[];
 if(!map||typeof map!=='object')return ['map must be an object'];
 if(typeof map.id!=='string'||!map.id)errors.push('map.id must be a non-empty string');
 if(typeof map.name!=='string'||!map.name)errors.push('map.name must be a non-empty string');
 const bounds=map.bounds;
 const boundsValid=Boolean(bounds)&&finite(bounds.minX)&&finite(bounds.maxX)&&finite(bounds.minZ)&&finite(bounds.maxZ)&&bounds.minX<bounds.maxX&&bounds.minZ<bounds.maxZ;
 if(!boundsValid)errors.push('map.bounds must be a finite, non-empty rectangle');
 for(const key of REQUIRED_MAP_ARRAYS)if(!Array.isArray(map[key]))errors.push(`map.${key} must be an array`);
 if(Array.isArray(map.blocks)){
  for(const [index,block] of map.blocks.entries()){
   if(!block||typeof block!=='object'){errors.push(`blocks[${index}] must be an object`);continue;}
   if(![block.x,block.z,block.w,block.d,block.h].every(finite))errors.push(`blocks[${index}] must have finite x/z/w/d/h`);
   else if(block.w<=0||block.d<=0||block.h<=0)errors.push(`blocks[${index}] must have positive w/d/h`);
  }
 }
 if(Array.isArray(map.spawns)&&boundsValid)for(const [index,spawn] of map.spawns.entries())if(!pointPair(spawn)||!inBounds(bounds,spawn[0],spawn[1]))errors.push(`spawns[${index}] must be an in-bounds [x,z] pair`);
 if(Array.isArray(map.pickups)&&boundsValid)for(const [index,pickup] of map.pickups.entries())if(!Array.isArray(pickup)||typeof pickup[0]!=='string'||!pointPair([pickup[1],pickup[2]])||!inBounds(bounds,pickup[1],pickup[2]))errors.push(`pickups[${index}] must be an in-bounds [kind,x,z] tuple`);
 if(Array.isArray(map.navNodes)&&boundsValid)for(const [index,node] of map.navNodes.entries())if(!pointObject(node)||!inBounds(bounds,node.x,node.z))errors.push(`navNodes[${index}] must be an in-bounds {x,z}`);
 if(Array.isArray(map.objectiveZones)&&boundsValid)for(const [index,zone] of map.objectiveZones.entries())if(!pointObject(zone)||!inBounds(bounds,zone.x,zone.z))errors.push(`objectiveZones[${index}] must be an in-bounds {x,z}`);
 if(map.teamSpawns&&boundsValid)for(const [team,points] of Object.entries(map.teamSpawns)){if(!Array.isArray(points)){errors.push(`teamSpawns.${team} must be an array`);continue;}for(const [index,spawn] of points.entries())if(!pointPair(spawn)||!inBounds(bounds,spawn[0],spawn[1]))errors.push(`teamSpawns.${team}[${index}] must be an in-bounds [x,z] pair`);}
 if(map.flagSpawns&&boundsValid)for(const [team,flag] of Object.entries(map.flagSpawns)){const p=pointObject(flag)?[flag.x,flag.z]:pointPair(flag)?[flag[0],flag[1]]:null;if(!p||!inBounds(bounds,p[0],p[1]))errors.push(`flagSpawns.${team} must be an in-bounds {x,z} or [x,z]`);}
 // Spatial additions are opt-in. Legacy blocks still mean the solid [0,h],
 // even if unrelated author metadata contains y/minY; no elevated solid schema
 // is introduced by the facade or authored-ground contracts.
 if(map.structures!==undefined&&!Array.isArray(map.structures))errors.push('map.structures must be an array');
 if(Array.isArray(map.structures))for(const [index,s] of map.structures.entries()){
  if(!s||typeof s!=='object'){errors.push(`structures[${index}] must be an object`);continue;}
  const label=`structures[${index}]`;
  if(s.floorPoints!==undefined){
   const points=s.floorPoints,valid=Array.isArray(points)&&points.length>=2&&points.every(p=>Array.isArray(p)&&p.length===3&&p.every(finite));
   if(!valid)errors.push(`${label}.floorPoints must contain finite [x,y,z] floor coordinates`);
   else for(let i=1;i<points.length;i++)if(Math.hypot(points[i][0]-points[i-1][0],points[i][2]-points[i-1][2])<1e-6)errors.push(`${label}.floorPoints need horizontal segment extent`);
   if(!finite(s.radius)||s.radius<2)errors.push(`${label}.radius must be at least 2 for a traversable tunnel`);
  }
  if(s.frame!==undefined){
   const f=s.frame,vec=v=>pointObject(v),unit=v=>vec(v)&&Math.abs(Math.hypot(v.x,v.z)-1)<1e-6;
   if(!f||!vec(f.origin)||!finite(f.origin?.y)||!finite(f.span)||f.span<=0||!finite(f.height)||f.height<=0||!unit(f.tangent)||!unit(f.normal)||Math.abs(f.tangent.x*f.normal.x+f.tangent.z*f.normal.z)>1e-6||!vec(f.parent)||!finite(f.parent?.y)||!finite(f.parent?.rot)||!vec(f.localOrigin)||!unit(f.localTangent)||!unit(f.localNormal))errors.push(`${label}.frame must contain a finite local/world facade frame`);
  }
  if(s.openSegments!==undefined&&(!Array.isArray(s.openSegments)||!s.openSegments.every(i=>Number.isInteger(i)&&i>=0&&i<16)||new Set(s.openSegments).size!==s.openSegments.length))errors.push(`${label}.openSegments must contain unique cavern segment indices 0..15`);
 }
 return errors;
}

/** True when a map has no structural schema errors. */
export const isMapSchemaValid=map=>validateMapSchema(map).length===0;

