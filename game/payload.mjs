// Payload: one team escorts a cart along an authored route while the other
// stalls and rolls it back. Pure and engine-free, like assault.mjs, so the sim,
// replay, network and tests share the same rules.
import {terrainSupportAt} from './terrain.mjs';
const boundsOf=arena=>arena.bounds||{minX:-13.55,maxX:13.55,minZ:-13.55,maxZ:13.55};
// Route points must sit on the ground so the cart and checkpoint rings are not
// buried on terrain maps (titan-valley, riverbend, convoy-line).
const groundAt=(arena,x,z,fallback)=>{const safe=Number.isFinite(fallback)?fallback:0;if(!arena.terrain)return safe;const support=terrainSupportAt(x,z,arena.terrain,arena.terrain.maxSlope??.9);return support?support.y:safe;};
const insideBlock=(arena,x,z,y=0)=>(arena.blocks||[]).some(block=>Math.abs(x-block.x)<=block.w/2&&Math.abs(z-block.z)<=block.d/2&&y<block.h-1e-6);
const inBounds=(arena,x,z)=>{const b=boundsOf(arena);return x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ;};
const pair=value=>Array.isArray(value)?(Number.isFinite(value[0])&&Number.isFinite(value[1])?{x:value[0],z:value[1]}:null):value&&Number.isFinite(value.x)&&Number.isFinite(value.z)?{x:value.x,z:value.z}:null;
const teamList=(teams,key,alt)=>{const source=teams?.[key]??teams?.[alt];return Array.isArray(source)?source.map(pair).filter(Boolean):[];};
const routeFloors=new WeakMap();
const routeCache=new WeakMap();
// Navigation includes jump/teleport links: only verified walking edges may carry
// a cart. Keep the runtime dependency injected rather than importing core.
function navigatedPath(arena,anchors,{navigation,floorAt,walkEdge,obstructed}){
 if(typeof floorAt!=='function'||typeof walkEdge!=='function'||typeof obstructed!=='function')throw new Error('Payload navigation requires floorAt, walkEdge and obstructed');
 // A frozen runtime navigation object is an immutable geometry/topology token.
 // Rebuild it when the arena changes; mutable fixture graphs deliberately bypass
 // caching. All identity keys are weak, and cached points never escape to a match.
 let cache=null;
 if(Object.isFrozen(navigation)){
  cache=routeCache;
  for(const key of [arena,navigation,floorAt,walkEdge]){
   if(!cache.has(key))cache.set(key,new WeakMap());
   cache=cache.get(key);
  }
  const cached=cache.get(obstructed);
  if(cached)return cached.map(point=>({...point}));
 }
 const clear=(a,b)=>{
  if(!walkEdge(a,b,arena))return false;
  const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.1));
  for(let i=0;i<=steps;i++){
   const x=a.x+(b.x-a.x)*i/steps,z=a.z+(b.z-a.z)*i/steps,y=floorAt(x,z,arena);
   // Extra clearance covers the space between samples, including wall corners.
   if(!Number.isFinite(y)||!inBounds(arena,x,z)||obstructed(x,y,z,.6,arena))return false;
  }
  return true;
 };
 const nodes=navigation.nodes,edges=navigation.edges;
 if(!nodes?.length)throw new Error('Payload navigation has no nodes');
 const nearest=point=>{let best=0;for(let i=1;i<nodes.length;i++)if(Math.hypot(nodes[i].x-point.x,nodes[i].z-point.z)<Math.hypot(nodes[best].x-point.x,nodes[best].z-point.z))best=i;return best;};
 const start=nearest(anchors[0]),end=nearest(anchors[anchors.length-1]);
 const estimate=nodes.map(point=>Math.hypot(point.x-nodes[end].x,point.y-nodes[end].y,point.z-nodes[end].z));
 const distances=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),open=new Set([start]);distances[start]=0;
 while(open.size){
  let current=-1;for(const i of open)if(current<0||distances[i]+estimate[i]<distances[current]+estimate[current])current=i;
  open.delete(current);if(current===end)break;
  for(const next of edges[current]||[]){
   const a=nodes[current],b=nodes[next];
   const distance=distances[current]+Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
   if(distance>=distances[next]||!clear(a,b))continue;
   distances[next]=distance;previous[next]=current;open.add(next);
  }
 }
 if(start===end||!Number.isFinite(distances[end]))throw new Error(`Payload has no walking route on ${arena.id||'arena'}`);
 const route=[];for(let i=end;i!==-1;i=previous[i])route.unshift(nodes[i]);
 // Preserve spawn anchors only when their complete connection is walkable.
 for(const [point,front] of [[anchors[0],true],[anchors[anchors.length-1],false]]){
  const y=floorAt(point.x,point.z,arena),anchor={...point,y},node=front?route[0]:route[route.length-1];
  if(Number.isFinite(y)&&Math.hypot(anchor.x-node.x,anchor.z-node.z)>1e-6&&clear(front?anchor:node,front?node:anchor))front?route.unshift(anchor):route.push(anchor);
 }
 const path=[{...route[0]}];
 for(let i=1;i<route.length;i++){
  const a=route[i-1],b=route[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.1));
  for(let j=1;j<=steps;j++){
   const x=a.x+(b.x-a.x)*j/steps,z=a.z+(b.z-a.z)*j/steps,y=floorAt(x,z,arena);
   if(!Number.isFinite(y))throw new Error('Payload route crosses unsupported ground');
   path.push({x,y,z});
  }
 }
 if(cache){
  path.forEach(Object.freeze);cache.set(obstructed,Object.freeze(path));
  return path.map(point=>({...point}));
 }
 return path;
}
// Pick roughly even waypoints across the map on walkable ground, anchored to the
// attacker and defender spawns so the route reads as a push across the arena.
export function payloadPath(arena,segments=3,options={}){
 const b=boundsOf(arena),teams=arena.teamSpawns||{};
 const red=teamList(teams,0,'red'),blue=teamList(teams,1,'blue'),spawns=(arena.spawns||[]).map(pair).filter(Boolean);
 let start=red[0]||spawns[0]||{x:b.minX+(b.maxX-b.minX)*.12,y:0,z:(b.minZ+b.maxZ)/2};
 let end=blue[0]||spawns[spawns.length-1]||{x:b.maxX-(b.maxX-b.minX)*.12,y:0,z:(b.minZ+b.maxZ)/2};
 if(!Number.isFinite(start.x)||!Number.isFinite(start.z))start={x:b.minX+(b.maxX-b.minX)*.12,y:0,z:(b.minZ+b.maxZ)/2};
 if(!Number.isFinite(end.x)||!Number.isFinite(end.z)||Math.hypot(end.x-start.x,end.z-start.z)<1){const centreX=(b.minX+b.maxX)/2;end={x:start.x<=centreX?b.maxX-(b.maxX-b.minX)*.12:b.minX+(b.maxX-b.minX)*.12,y:0,z:(b.minZ+b.maxZ)/2};}
 if(options.navigation)return navigatedPath(arena,[start,end],options);
 const push=(candidate,used)=>{const point=candidate?pair(candidate):null;if(!point)return;const x=point.x,z=point.z,rawY=Number.isFinite(candidate.y)?candidate.y:(Number.isFinite(candidate.topY)?candidate.topY:0),y=groundAt(arena,x,z,rawY);if(!Number.isFinite(x)||!Number.isFinite(z)||!inBounds(arena,x,z)||insideBlock(arena,x,z,y))return;if(used.some(other=>Math.hypot(other.x-x,other.z-z)<1.5))return;used.push({x,y,z});};
 const candidates=[];
 for(const zone of arena.objectiveZones||[])push(zone,candidates);
 for(const node of arena.navNodes||[])push({x:node.x,z:node.z,y:node.y},candidates);
 for(const spawn of arena.spawns||[])push({x:spawn[0],z:spawn[1],y:0},candidates);
 for(const pickup of arena.pickups||[])push({x:pickup[1],z:pickup[2],y:0},candidates);
 for(const platform of arena.platforms||[])push({x:platform.x,z:platform.z,y:platform.y??platform.topY??0},candidates);
 const count=Math.max(1,Math.min(6,Math.round(segments)||1))+1;
 const anchors=[{x:start.x,y:groundAt(arena,start.x,start.z,start.y),z:start.z},{x:end.x,y:groundAt(arena,end.x,end.z,end.y),z:end.z}];
 const path=[anchors[0]];
 // Seed the anchors so no interior waypoint can collapse onto the start/end and
 // produce a zero-length segment (which would award a checkpoint with no push).
 const used=[{x:anchors[0].x,z:anchors[0].z},{x:anchors[1].x,z:anchors[1].z}];
 for(let i=1;i<count-1;i++){
  const t=i/(count-1),lx=anchors[0].x+(anchors[1].x-anchors[0].x)*t,lz=anchors[0].z+(anchors[1].z-anchors[0].z)*t,ly=anchors[0].y+(anchors[1].y-anchors[0].y)*t,previous=path[path.length-1];
  let best=null,bestDistance=Infinity;
  for(const candidate of candidates){
   if(used.includes(candidate))continue;
   if(used.some(other=>Math.hypot(other.x-candidate.x,other.z-candidate.z)<1.5))continue;
   const distance=(candidate.x-lx)**2+(candidate.z-lz)**2;
   if(distance<bestDistance){bestDistance=distance;best=candidate;}
  }
  if(best){used.push(best);path.push({x:best.x,y:best.y,z:best.z});}
  else if(Math.hypot(lx-previous.x,lz-previous.z)>=1)path.push({x:lx,y:groundAt(arena,lx,lz,ly),z:lz});
 }
 path.push(anchors[1]);
 return path;
}
export function payloadTemplate(arena,{segments=3,radius=4.5,speed:requestedSpeed,...routing}={}){
 const path=payloadPath(arena,segments,routing),waypointDistance=[0];
 for(let i=1;i<path.length;i++){const previous=path[i-1],point=path[i];waypointDistance.push(waypointDistance[i-1]+Math.hypot(point.x-previous.x,(point.y??0)-(previous.y??0),point.z-previous.z));}
 const total=waypointDistance[waypointDistance.length-1]||0;
 const requested=Number(requestedSpeed);
 // Default pace targets a ~100-150s unopposed full route: total/150 with a
 // bounded 1.5-4.0 speed. Endless 14 u/s carts ended rounds in seconds.
 const speed=Number.isFinite(requested)&&requested>0?requested:Math.max(1.5,Math.min(4,total/150));
 const checkpointCount=Math.max(1,Math.min(6,Math.round(segments)||1));
 const checkpointDistances=routing.navigation?Array.from({length:checkpointCount},(_,i)=>total*((i+1)/checkpointCount)):waypointDistance.slice(1);
 const checkpoints=checkpointDistances.map((distance,index)=>{const point=payloadPosition({path,waypointDistance,distance});return {id:`cp${index+1}`,x:point.x,z:point.z,y:routing.navigation?routing.floorAt(point.x,point.z,arena):point.y??0,radius,owner:null,captureTeam:null,progress:0,distance};});
 const state={kind:'payload',attacker:0,defender:1,path,waypointDistance,distance:0,total,speed,radius,position:{...path[0]},pushing:null,contested:false,delivered:false,winner:null,checkpointsReached:0,checkpoints,active:0};
 state.zones=checkpoints;
 if(routing.navigation)routeFloors.set(state,(x,z)=>routing.floorAt(x,z,arena));
 return state;
}
export function payloadPosition(state){
 const path=state?.path;
 if(!Array.isArray(path)||!path.length)return {x:0,y:0,z:0};
 if(path.length===1)return {x:path[0].x,y:path[0].y??0,z:path[0].z};
 const distances=state.waypointDistance||[];
 let index=0,high=Math.max(0,path.length-2);
 while(index<high){const middle=Math.floor((index+high)/2);if(state.distance>distances[middle+1])index=middle+1;else high=middle;}
 const segment=Math.max(0,(distances[index+1]??0)-distances[index]);
 const t=segment>0?Math.max(0,Math.min(1,(state.distance-distances[index])/segment)):0;
 const from=path[index],to=path[index+1]||from;
 const x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t;
 return {x,y:routeFloors.get(state)?.(x,z)??((from.y??0)+((to.y??0)-(from.y??0))*t),z};
}
export const payloadProgress=state=>state&&state.total>0?Math.max(0,Math.min(100,state.distance/state.total*100)):0;
export const standing=(state,actor,margin=0)=>{const position=state?.position??payloadPosition(state);return Boolean(actor&&actor.health>0&&Math.hypot(actor.x-position.x,actor.z-position.z)<=(state?.radius??0)+margin&&Math.abs((actor.y??0)-position.y)<=5);};
export function stepPayload(state,actors,dt,options={}){
 const {emit,teamScores,scoreLimit}=options;
 if(!state||state.delivered)return {moved:0,checkpoint:null,delivered:state?.delivered??false};
 const attacker=state.attacker??0,defender=state.defender??1,position=payloadPosition(state);
 state.position=position;
 const nearby=(actors||[]).filter(actor=>standing(state,actor)),attackers=nearby.filter(actor=>actor.team===attacker).length,defenders=nearby.filter(actor=>actor.team===defender).length;
 let moved=0;
 if(attackers>0&&defenders>0){state.contested=true;state.pushing=null;}
 else if(attackers>0){
  state.contested=false;state.pushing=attacker;
  const advance=state.speed*dt;
  state.distance=Math.min(state.total,state.distance+advance);moved=advance;
 }else if(defenders>0){
  state.contested=false;state.pushing=defender;
  const floor=state.checkpointsReached>0?(state.checkpoints[state.checkpointsReached-1].distance??0):0;
  const rollback=state.speed*.5*dt,next=Math.max(floor,state.distance-rollback);
  moved=next-state.distance;state.distance=next;
 }else{state.contested=false;state.pushing=null;}
 if(moved!==0)state.position=payloadPosition(state);
 let checkpoint=null;
 while(state.checkpointsReached<state.checkpoints.length&&state.distance>=state.checkpoints[state.checkpointsReached].distance-1e-6){
  checkpoint=state.checkpoints[state.checkpointsReached];
  checkpoint.owner=attacker;checkpoint.progress=100;state.checkpointsReached++;state.active=state.checkpointsReached;
  if(teamScores)teamScores[attacker]=(teamScores[attacker]||0)+1;
  emit?.('payload-checkpoint',{checkpoint:checkpoint.id,index:state.checkpointsReached,team:attacker,distance:state.distance,total:state.total});
 }
 if(state.distance>=state.total-1e-6&&!state.delivered){
  state.delivered=true;state.winner=attacker;state.distance=state.total;
  emit?.('payload-delivered',{team:attacker,total:state.total});
 }
 if(scoreLimit&&teamScores&&(teamScores[attacker]||0)>=scoreLimit)state.winner=attacker;
 return {moved,checkpoint,delivered:state.delivered};
}
