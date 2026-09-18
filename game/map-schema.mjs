import {validateTraversal,validateLane} from './cocs-economy.mjs';
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

// ---- LATTICE builders (schema v3, opt-in) ---------------------------------
//
// The COCS theatre layer is additive and *gated on presence*: a legacy map that
// never authors `playBounds`/`nodes`/`lattice`/`terminals`/`lanes` picks up no
// new required fields and no version bump. `LEVELGEN_SCHEMA_VERSION` therefore
// stays 2 and the v3 semantics ride on the authored fields themselves.
//
// Frozen interface the runtime/mode layer consumes:
//   arena.playBounds = {minX,maxX,minZ,maxZ,frontage,laneSep,maxNodeSpacing}
//   arena.nodes      = [{id,x,z,r,archetype}]
//   arena.lattice    = [[a,b], ...]        // capture-adjacency, node ids
//   arena.terminals  = [{id,nodeId,kind,x,z,y}]
//   arena.lanes      = [{id,kind,waypoints,...}]  // kind = traversal identity
export const NODE_ARCHETYPES=Object.freeze(['front','economy','relay','hq','array']);
export const CAPTURABLE_ARCHETYPES=Object.freeze(['front','economy','relay']);
export const LANE_TRAVERSAL_KINDS=Object.freeze(['vehicle-road','cqc','zipline-flank']);
export const TERMINAL_KINDS=Object.freeze(['relay','vault','array-relay']);

/** A lattice/objective node. `r` is the capture radius in metres. */
export const node=(id,x,z,r=8,archetype='front')=>({id,x,z,r,archetype});
/** An undirected lattice edge as an `[a,b]` node-id pair. */
export const edge=(a,b)=>[a,b];
/** A physical lane. `kind` is the traversal identity, mirrored into `traversal.kind`. */
export const lane=(id,kind,waypoints=[],{traversal={},...rest}={})=>({id,kind,waypoints,traversal:{kind,...traversal},...rest});
/** A terminal hosted on a relay/array node. */
export const terminal=(id,nodeId,kind,x,z,y=0)=>({id,nodeId,kind,x,z,y});

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
const PLAY_BOUNDS_FRONTAGE_MAX=240;
const rectangle=b=>Boolean(b)&&finite(b.minX)&&finite(b.maxX)&&finite(b.minZ)&&finite(b.maxZ)&&b.minX<b.maxX&&b.minZ<b.maxZ;
const latticeFrame=map=>rectangle(map.playBounds)?{...map.playBounds,label:'playBounds'}:rectangle(map.bounds)?{...map.bounds,label:'map.bounds'}:null;

// §6A.2.1 traversal layer: the map opts in by authoring `traversal`/`depots`.
// When it does, all three lanes must carry the fixed doctrine fields, every
// device must match its lane identity, and every exit must honour arrival
// protection (>=5 m, >=1.0 s, >=15 m from every spawn, >=2 approaches, off a
// capture radius). Legacy maps that never author the layer see no new errors.
function traversalContext(map){
 const lanes=Array.isArray(map.lanes)?map.lanes:[];
 const nodes=Array.isArray(map.nodes)?map.nodes:[];
 const spawns=[];
 const collect=value=>{
  if(!value)return;
  if(Array.isArray(value)){
   if(Array.isArray(value[0])){for(const entry of value)collect(entry);}
   else if(finite(value[0])&&finite(value[1]))spawns.push({x:value[0],z:value[1]});
  }else if(typeof value==='object'){
   if(finite(value.x)&&finite(value.z))spawns.push({x:value.x,z:value.z});
   else for(const entry of Object.values(value))collect(entry);
  }
 };
 collect(map.teamSpawns);
 if(!spawns.length)collect(map.spawns);
 return {lanes,nodes,spawns,requireLane:true,requireArrival:true};
}

function traversalLayerIssues(map){
 const errors=[];
 if(map.traversal===undefined&&map.depots===undefined)return errors;
 const context=traversalContext(map);
 if(map.traversal!==undefined){
  if(!Array.isArray(map.traversal))errors.push('map.traversal must be an array of devices');
  else{
   const ids=new Set();
   for(const [index,device] of map.traversal.entries()){
    const label=`traversal[${index}]`;
    if(!device||typeof device!=='object'){errors.push(`${label} must be an object`);continue;}
    if(typeof device.id!=='string'||!device.id)errors.push(`${label}.id must be a non-empty string`);
    else if(ids.has(device.id))errors.push(`${label}.id ${device.id} is duplicated`);
    else ids.add(device.id);
    for(const error of validateTraversal(device,context).errors)errors.push(`${label}: ${error}`);
   }
  }
 }
 if(map.depots!==undefined){
  if(!Array.isArray(map.depots))errors.push('map.depots must be an array of depots');
  else{
   const ids=new Set();
   for(const [index,depot] of map.depots.entries()){
    const label=`depots[${index}]`;
    if(!depot||typeof depot!=='object'){errors.push(`${label} must be an object`);continue;}
    if(typeof depot.id!=='string'||!depot.id)errors.push(`${label}.id must be a non-empty string`);
    else if(ids.has(depot.id))errors.push(`${label}.id ${depot.id} is duplicated`);
    else ids.add(depot.id);
    if(depot.team!==undefined&&depot.team!==null&&depot.team!==0&&depot.team!==1)errors.push(`${label}.team must be 0, 1 or null`);
    for(const error of validateTraversal({...depot,kind:'depot'},context).errors)errors.push(`${label}: ${error}`);
   }
  }
 }
 const lanes=Array.isArray(map.lanes)?map.lanes:[];
 const identities=new Set();
 for(const [index,laneObj] of lanes.entries()){
  const label=`lanes[${index}]`;
  for(const error of validateLane(laneObj,{requireDoctrine:true}).errors)errors.push(`${label}: ${error}`);
  const identity=laneObj?.identity??laneObj?.kind;
  if(identities.has(identity))errors.push(`${label}: identity ${identity} is duplicated`);
  identities.add(identity);
 }
 return errors;
}

// All structural v3 checks live here so `validateMapSchema` (presence-gated)
// and `validateLattice` (doctrine) can never drift apart.
function latticeIssues(map){
 const errors=[],p=map.playBounds;
 if(p!==undefined){
  if(!p||typeof p!=='object')errors.push('map.playBounds must be an object');
  else if(!rectangle(p))errors.push('map.playBounds must be a finite, non-empty rectangle');
  else{
   const derived=Math.max(p.maxX-p.minX,p.maxZ-p.minZ);
   if(p.frontage!==undefined&&(!finite(p.frontage)||p.frontage<=0))errors.push('map.playBounds.frontage must be a positive number');
   if((p.frontage??derived)>PLAY_BOUNDS_FRONTAGE_MAX+1e-9)errors.push('map.playBounds.frontage must be ≤240 m');
   if(p.laneSep!==undefined&&(!finite(p.laneSep)||p.laneSep<0))errors.push('map.playBounds.laneSep must be a non-negative number');
   if(p.maxNodeSpacing!==undefined&&(!finite(p.maxNodeSpacing)||p.maxNodeSpacing<0))errors.push('map.playBounds.maxNodeSpacing must be a non-negative number');
  }
 }
 for(const [key,label] of [['nodes','array of nodes'],['lattice','array of [a,b] edges'],['terminals','array of terminals'],['lanes','array of lanes']])
  if(map[key]!==undefined&&!Array.isArray(map[key]))errors.push(`map.${key} must be an ${label}`);
 const frame=latticeFrame(map),ids=new Set();
 if(Array.isArray(map.nodes))for(const [index,n] of map.nodes.entries()){
  const label=`nodes[${index}]`;
  if(!n||typeof n!=='object'){errors.push(`${label} must be an object`);continue;}
  if(typeof n.id!=='string'||!n.id)errors.push(`${label}.id must be a non-empty string`);
  else if(ids.has(n.id))errors.push(`${label}.id ${n.id} is duplicated`);
  else ids.add(n.id);
  if(!finite(n.x)||!finite(n.z))errors.push(`${label} must have finite x/z`);
  if(!finite(n.r)||n.r<=0)errors.push(`${label}.r must be a positive capture radius`);
  if(!NODE_ARCHETYPES.includes(n.archetype))errors.push(`${label}.archetype must be one of ${NODE_ARCHETYPES.join('/')}`);
  if(frame&&finite(n.x)&&finite(n.z)&&!inBounds(frame,n.x,n.z))errors.push(`${label} must sit inside ${frame.label}`);
 }
 if(Array.isArray(map.lattice))for(const [index,link] of map.lattice.entries()){
  if(!Array.isArray(link)||link.length!==2||typeof link[0]!=='string'||typeof link[1]!=='string'){errors.push(`lattice[${index}] must be a [a,b] node-id pair`);continue;}
  if(link[0]===link[1])errors.push(`lattice[${index}] cannot self-reference ${link[0]}`);
  for(const id of link)if(Array.isArray(map.nodes)&&!ids.has(id))errors.push(`lattice[${index}] references unknown node ${id}`);
 }
 if(Array.isArray(map.terminals)){
  const byId=new Map((Array.isArray(map.nodes)?map.nodes:[]).filter(n=>n&&typeof n.id==='string').map(n=>[n.id,n])),terminalIds=new Set();
  for(const [index,t] of map.terminals.entries()){
   const label=`terminals[${index}]`;
   if(!t||typeof t!=='object'){errors.push(`${label} must be an object`);continue;}
   if(typeof t.id!=='string'||!t.id)errors.push(`${label}.id must be a non-empty string`);
   else if(terminalIds.has(t.id))errors.push(`${label}.id ${t.id} is duplicated`);
   else terminalIds.add(t.id);
   if(!finite(t.x)||!finite(t.z))errors.push(`${label} must have finite x/z`);
   if(!TERMINAL_KINDS.includes(t.kind))errors.push(`${label}.kind must be one of ${TERMINAL_KINDS.join('/')}`);
   const host=typeof t.nodeId==='string'?byId.get(t.nodeId):null;
   if(typeof t.nodeId!=='string'||!t.nodeId)errors.push(`${label}.nodeId must reference a lattice node`);
   else if(Array.isArray(map.nodes)&&!host)errors.push(`${label}.nodeId references unknown node ${t.nodeId}`);
   else if(host){
    if(!['relay','array','hq'].includes(host.archetype))errors.push(`${label}.nodeId must host on a relay/array/HQ node, not ${host.archetype}`);
    else if(finite(t.x)&&finite(t.z)&&finite(host.x)&&finite(host.z)&&Math.hypot(t.x-host.x,t.z-host.z)>host.r+1e-9)errors.push(`${label} must sit inside ${host.id}'s capture radius`);
   }
  }
 }
 if(Array.isArray(map.lanes)){
  const laneIds=new Set();
  for(const [index,l] of map.lanes.entries()){
   const label=`lanes[${index}]`;
   if(!l||typeof l!=='object'){errors.push(`${label} must be an object`);continue;}
   if(typeof l.id!=='string'||!l.id)errors.push(`${label}.id must be a non-empty string`);
   else if(laneIds.has(l.id))errors.push(`${label}.id ${l.id} is duplicated`);
   else laneIds.add(l.id);
   const kind=l.kind??l.traversal?.kind;
   if(!LANE_TRAVERSAL_KINDS.includes(kind))errors.push(`${label}.kind must be one of ${LANE_TRAVERSAL_KINDS.join('/')}`);
   if(l.traversal!==undefined&&(!l.traversal||typeof l.traversal!=='object'))errors.push(`${label}.traversal must be an object`);
   else if(l.traversal?.kind!==undefined&&!LANE_TRAVERSAL_KINDS.includes(l.traversal.kind))errors.push(`${label}.traversal.kind must be one of ${LANE_TRAVERSAL_KINDS.join('/')}`);
   if(!Array.isArray(l.waypoints)||l.waypoints.length<2)errors.push(`${label}.waypoints must hold at least two [x,z] points`);
   else for(const [windex,w] of l.waypoints.entries()){
    if(!pointPair(w))errors.push(`${label}.waypoints[${windex}] must be an [x,z] pair`);
    else if(frame&&!inBounds(frame,w[0],w[1]))errors.push(`${label}.waypoints[${windex}] must sit inside ${frame.label}`);
   }
   if(l.width!==undefined&&(!finite(l.width)||l.width<6))errors.push(`${label}.width must be at least 6 m`);
   if(l.slopeCap!==undefined&&(!finite(l.slopeCap)||l.slopeCap<=0))errors.push(`${label}.slopeCap must be a positive number`);
  }
 }
 errors.push(...traversalLayerIssues(map));
 return errors;
}

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
 // Schema v3 lattice layer: only validated when the map opts in by authoring
 // any of the fields. Legacy maps keep the v2 contract and stay valid.
 if(map.playBounds!==undefined||map.nodes!==undefined||map.lattice!==undefined||map.terminals!==undefined||map.lanes!==undefined)errors.push(...latticeIssues(map));
 return errors;
}

/** True when a map has no structural schema errors. */
export const isMapSchemaValid=map=>validateMapSchema(map).length===0;

/** Deeper lattice doctrine checks for maps that author the v3 layer. Returns [] when valid or opted out. */
export function validateLattice(map){
 const errors=latticeIssues(map);
 if(!map||typeof map!=='object')return errors;
 const nodes=Array.isArray(map.nodes)?map.nodes:[],edges=Array.isArray(map.lattice)?map.lattice:[];
 if(!nodes.length&&!edges.length)return errors;
 const byId=new Map(nodes.filter(n=>n&&typeof n.id==='string').map(n=>[n.id,n])),ids=new Set(byId.keys()),adjacency=new Map([...ids].map(id=>[id,new Set()]));
 for(const link of edges)if(Array.isArray(link)&&ids.has(link[0])&&ids.has(link[1])&&link[0]!==link[1]){adjacency.get(link[0]).add(link[1]);adjacency.get(link[1]).add(link[0]);}
 if(ids.size){
  const start=ids.values().next().value,seen=new Set([start]),queue=[start];
  while(queue.length)for(const next of adjacency.get(queue.shift()))if(!seen.has(next)){seen.add(next);queue.push(next);}
  if(seen.size<ids.size)errors.push(`lattice must be connected: ${ids.size-seen.size} node(s) unreachable from ${start}`);
 }
 const hqs=[...byId.values()].filter(n=>n.archetype==='hq'),arrays=[...byId.values()].filter(n=>n.archetype==='array'),capturable=[...byId.values()].filter(n=>CAPTURABLE_ARCHETYPES.includes(n.archetype));
 if(hqs.length&&hqs.length!==2)errors.push(`lattice HQ anchors must come in pairs, found ${hqs.length}`);
 if(capturable.length<3)errors.push(`lattice must field at least 3 capturable nodes (front/economy/relay), found ${capturable.length}`);
 for(const hq of hqs)if(![...(adjacency.get(hq.id)||[])].some(id=>CAPTURABLE_ARCHETYPES.includes(byId.get(id)?.archetype)))errors.push(`lattice HQ ${hq.id} must be adjacent to a capturable node`);
 for(const array of arrays){
  const approaches=new Set(adjacency.get(array.id)||[]);
  for(const laneObj of (Array.isArray(map.lanes)?map.lanes:[]))for(const w of laneObj?.waypoints||[])if(Array.isArray(w)&&finite(w[0])&&finite(w[1])&&finite(array.x)&&finite(array.z)&&Math.hypot(w[0]-array.x,w[1]-array.z)<=array.r+8)approaches.add(laneObj.id);
  if(approaches.size<2)errors.push(`lattice ARRAY ${array.id} needs at least 2 approach vectors`);
  if(![...(adjacency.get(array.id)||[])].some(id=>['hq','front'].includes(byId.get(id)?.archetype)))errors.push(`lattice ARRAY ${array.id} must anchor behind an HQ or front node`);
 }
 return errors;
}

/** True when a map authors no v3 lattice or passes every lattice doctrine check. */
export const isLatticeValid=map=>validateLattice(map).length===0;

