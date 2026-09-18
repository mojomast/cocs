import {clamp,dist,eye,aim,blastUnsafe,walkEdge,floorAt,obstructed,nearest} from './core.mjs';
import {POWERUPS,WEAPONS,RULES} from './data.mjs';
import {modeWeapon,teamMode,loadoutAllows,loadoutStart} from './config.mjs';
import {harnessBotHints,preferredHarnessWeapon} from './harness-profiles.mjs';
import {operatorProfile,preferredOperatorWeapon} from './operator-profiles.mjs';
import {botBehavior,botWeaponBandPick} from './bot-personalities.mjs';
import {OPERATOR_KITS} from './kits.mjs';
import {enemyBehavior} from './enemy-types.mjs';
import {turnToward} from './character-anim.mjs';
import {payloadPosition} from './payload.mjs';
import {cocsAssignment,cocsBotDestination,cocsScoutInput} from './cocs-bots.mjs';
import {vehicleSeatFor,vehicleMounted} from './vehicles.mjs';
const v=(x=0,y=0,z=0)=>({x,y,z});
const norm=a=>{const l=Math.hypot(a.x,a.y,a.z)||1;return v(a.x/l,a.y/l,a.z/l)};
export function defensivePost(match,a){const base=match.flagSpawns[a.team]||[match.center.x,match.center.z],dx=match.center.x-base[0],dz=match.center.z-base[1],length=Math.hypot(dx,dz)||1,distance=Math.min(12,length*.35),x=base[0]+dx/length*distance,z=base[1]+dz/length*distance;return {x,y:floorAt(x,z,match.arena)??0,z};}

const FLANK_MIN_LATERAL=.35,FLANK_TTL=6,FLANK_MAX_ROUTE=34;
// Flank routing. The chosen node must be lateral to the straight a→enemy line
// (a real side approach, not a slower walk down the middle), closer to the enemy
// than the bot is, and within a bounded route. The flank is keyed to the current
// target and expires, so a later encounter cannot inherit a stale decision.
export function flankDestination(match,a,enemy){
 const b=a.bot||(a.bot={}),target=enemy||{x:a.x,y:a.y??0,z:a.z};
 const nodes=match.nav?.length?match.nav:null;
 const key=String(b.target??-1),now=Number.isFinite(match.time)?match.time:0;
 if(b.flank&&(b.flank.key!==key||now>=(b.flank.until??0))){b.flank=null;b.flankDone=false;}
 if(b.flank){if(dist(a,b.flank)<7){b.flankDone=true;b.flank=null;}else return b.flank;}
 if(!nodes)return {x:target.x,y:target.y??0,z:target.z};
 const directX=target.x-a.x,directZ=target.z-a.z,directLength=Math.hypot(directX,directZ)||1,unitX=directX/directLength,unitZ=directZ/directLength;
 let best=null,bestScore=Infinity;
 for(const node of nodes){
  if(!Number.isFinite(node.x)||!Number.isFinite(node.z))continue;
  const travel=Math.hypot(node.x-a.x,node.z-a.z),toEnemy=Math.hypot(node.x-target.x,node.z-target.z);
  if(travel<8||travel>FLANK_MAX_ROUTE||toEnemy>=directLength)continue;
  const lateral=Math.abs((node.x-a.x)*-unitZ+(node.z-a.z)*unitX);
  if(lateral<directLength*FLANK_MIN_LATERAL)continue;
  const score=travel+toEnemy-lateral*.8;
  if(score<bestScore){bestScore=score;best=node;}
 }
 if(!best)return {x:target.x,y:target.y??0,z:target.z};
 b.flank={x:best.x,y:Number.isFinite(best.y)?best.y:(floorAt(best.x,best.z,match.arena)??0),z:best.z,key,until:now+FLANK_TTL};
 b.flankDone=false;
 return b.flank;
}

const COVER_SAFETY_CAP=12,COVER_SAFETY_WEIGHT=.55,COVER_MAX_ROUTE=34;
// Worst-case slack between a node's route cost and its cover score: the largest
// possible safety benefit (cap*weight) plus the worst range penalty (-6). A
// candidate whose route cost minus this slack already exceeds the best score
// found cannot win (or tie), so the scan can stop.
const COVER_SCORE_SLACK=COVER_SAFETY_CAP*COVER_SAFETY_WEIGHT+6;
// Single-source shortest path over the nav graph. One flood gives route cost to
// every node, so cover scoring is O(E log V) per call instead of one A* per
// candidate.
function dijkstraFrom(from,nodes,edges){
 const dist=new Array(nodes.length).fill(Infinity);
 if(!Number.isInteger(from)||from<0||from>=nodes.length)return dist;
 dist[from]=0;const heap=[];heapPush(heap,from,0);
 while(heap.length){
  const current=heapPop(heap).item;
  for(const next of edges[current]||[]){
   if(!Number.isInteger(next)||next<0||next>=nodes.length)continue;
   const tentative=dist[current]+Math.hypot(nodes[current].x-nodes[next].x,nodes[current].z-nodes[next].z);
   if(tentative<dist[next]){dist[next]=tentative;heapPush(heap,next,tentative);}
  }
 }
 return dist;
}
// Route cost between two points on the nav graph. Uses A* when the caller
// supplies the edge list, otherwise falls back to straight-line distance (which
// is exact on an obstacle-free synthetic graph).
export function routeTo(match,a,point){
 const nodes=match?.nav,edges=match?.edges;
 if(Array.isArray(nodes)&&nodes.length&&Array.isArray(edges)){const result=astar(a,point,nodes,edges);return {cost:result.cost,reachable:result.reachable};}
 return {cost:Math.hypot(a.x-point.x,a.z-point.z),reachable:true};
}
// A flood is a pure function of (source, graph) and the nav graph is static for
// a match, so repeated cover checks from the same nearest node reuse it. The
// cache is a bounded FIFO; eviction order is the call order, so surviving
// entries are deterministic for a given sequence.
const dijkstraCache=new WeakMap(),DIJKSTRA_CACHE_MAX=96;
function cachedDijkstra(from,nodes,edges){
 let entry=dijkstraCache.get(nodes);
 if(!entry||entry.edges!==edges){entry={edges,floods:new Map(),order:[]};dijkstraCache.set(nodes,entry);}
 const hit=entry.floods.get(from);
 if(hit)return hit;
 const flood=dijkstraFrom(from,nodes,edges);
 entry.floods.set(from,flood);entry.order.push(from);
 if(entry.order.length>DIJKSTRA_CACHE_MAX)entry.floods.delete(entry.order.shift());
 return flood;
}
// Per-node cover geometry (non-finite exclusion + obstruction) depends only on
// the nav graph and arena, never the threat, so it is baked once per graph.
const coverNodeCache=new WeakMap();
function coverNodeSafety(match,nodes){
 const cached=coverNodeCache.get(nodes);
 if(cached&&cached.arena===match.arena)return cached;
 const y=new Float64Array(nodes.length),safe=new Uint8Array(nodes.length);
 for(let i=0;i<nodes.length;i++){
  const node=nodes[i];
  if(!Number.isFinite(node.x)||!Number.isFinite(node.z))continue;
  const ny=Number.isFinite(node.y)?node.y:(floorAt(node.x,node.z,match.arena)??0);
  y[i]=ny;
  safe[i]=obstructed(node.x,ny,node.z,RULES.radius*.9,match.arena)?0:1;
 }
 const entry={arena:match.arena,y,safe};coverNodeCache.set(nodes,entry);return entry;
}
// Seeks reachable cover that breaks line of sight to a visible threat. Bots
// defending a fixed objective use this to disengage and re-peek instead of
// trading at low health. Candidates are scored by route cost, a capped
// safety-distance benefit (farther from the threat is safer, up to a cap), and
// whether the threat remains inside the bot's weapon range. Pure and
// deterministic: equal inputs always resolve to the same node.
//
// Scoring is exact but accelerated: candidates are visited in ascending route
// cost, and the visibility ray is only cast while the node's route cost can
// still yield a score that beats (or index-ties) the incumbent. Nodes whose
// static obstruction fails, and nodes beyond the route budget, are excluded
// before any ray, and floods/geometry are cached across calls. The chosen node
// and the index tie-break are identical to the linear scan.
export function coverPoint(match,a,threat){
 if(!a||!threat||!match?.nav?.length)return null;
 const nodes=match.nav,edges=Array.isArray(match.edges)?match.edges:null,threatEye=eye(threat),threatX=threat.x??0,threatZ=threat.z??0;
 const weaponRange=WEAPONS[a.weapon??0]?.range??70;
 const geometry=coverNodeSafety(match,nodes);
 const costs=edges?cachedDijkstra(nearest(a,nodes),nodes,edges):null;
 const candidates=[];
 for(let index=0;index<nodes.length;index++){
  if(!geometry.safe[index])continue;
  const node=nodes[index];
  const cost=costs?costs[index]:Math.hypot(a.x-node.x,a.z-node.z);
  if(!Number.isFinite(cost)||cost>COVER_MAX_ROUTE||cost<1.5)continue;
  candidates.push(index);
 }
 if(costs)candidates.sort((p,q)=>{const d=costs[p]-costs[q];return d!==0?d:p-q;});
 else candidates.sort((p,q)=>{const d=Math.hypot(a.x-nodes[p].x,a.z-nodes[p].z)-Math.hypot(a.x-nodes[q].x,a.z-nodes[q].z);return d!==0?d:p-q;});
 let best=null,bestScore=Infinity,bestIndex=-1;
 for(let k=0;k<candidates.length;k++){
  const index=candidates[k],node=nodes[index];
  const cost=costs?costs[index]:Math.hypot(a.x-node.x,a.z-node.z);
  if(cost-COVER_SCORE_SLACK>bestScore)break;
  const threatDistance=Math.hypot(node.x-threatX,node.z-threatZ);
  const safety=Math.min(threatDistance,COVER_SAFETY_CAP)*COVER_SAFETY_WEIGHT;
  const usable=threatDistance<=weaponRange?0:-6;
  const score=cost-safety+usable;
  if(!(score<bestScore||(score===bestScore&&index<bestIndex)))continue;
  if(match.visible({x:node.x,y:geometry.y[index]+1.2,z:node.z},threatEye))continue;
  bestScore=score;bestIndex=index;best={x:node.x,y:geometry.y[index],z:node.z};
 }
 return best;
}

export function patrolPoint(match,a){const nodes=match.nav?.length?match.nav:null;if(nodes){const zone=npcZone(a);if(zone){const radius=Number.isFinite(zone.r)?zone.r:zoneLeash(zone),pool=[];for(let i=0;i<nodes.length;i++){const n=nodes[i];if(Math.hypot(n.x-zone.x,n.z-zone.z)<=radius)pool.push(i);}if(!pool.length){let best=-1,bestDistance=Infinity;for(let i=0;i<nodes.length;i++){const distance=Math.hypot(nodes[i].x-zone.x,nodes[i].z-zone.z);if(distance<bestDistance){bestDistance=distance;best=i;}}if(best>=0)pool.push(best);}if(pool.length){const current=pool.indexOf(a.bot.patrol),from=current>=0?current:0;let chosen=-1;for(let i=1;i<=pool.length;i++){const index=pool[(from+i)%pool.length],n=nodes[index];if(pool.length===1||Math.hypot(n.x-a.x,n.z-a.z)>4){chosen=index;break;}}if(chosen<0)chosen=pool[(from+1)%pool.length];a.bot.patrol=chosen;const n=nodes[chosen];return {x:n.x,y:Number.isFinite(n.y)?n.y:(floorAt(n.x,n.z,match.arena)??0),z:n.z};}}const start=a.bot.patrol||0,index=(start+1)%nodes.length;let chosen=null;for(let i=0;i<nodes.length;i++){const n=nodes[(index+i)%nodes.length];if(Math.hypot(n.x-a.x,n.z-a.z)>8){chosen=n;a.bot.patrol=(index+i+1)%nodes.length;break;}}if(!chosen){a.bot.patrol=index;chosen=nodes[index];}return {x:chosen.x,y:Number.isFinite(chosen.y)?chosen.y:(floorAt(chosen.x,chosen.z,match.arena)??0),z:chosen.z};}const p=match.pickups.find(p=>!p.wait&&dist(a,p)>6)||match.pickups[0];return p?{x:p.x,y:p.y,z:p.z}:{x:match.center.x,y:floorAt(match.center.x,match.center.z,match.arena)??0,z:match.center.z};}

export function separation(match,a,radius=2.6){let x=0,z=0;for(const other of match.actors){if(other===a||other.health<=0)continue;const dx=a.x-other.x,dz=a.z-other.z,d=Math.hypot(dx,dz);if(d>1e-4&&d<radius){const weight=(radius-d)/radius;x+=dx/d*weight;z+=dz/d*weight;}}return {x,z};}

export function spreadBias(match,a,point){const h=(Math.imul((a.id|0)+1,73856093)^Math.imul(Math.round((point.x||0)*10),19349663)^Math.imul(Math.round((point.z||0)*10),83492791))>>>0;return (h%997)/997;}

// Explicit weapon-index selection: index 0 is a real, deliberate choice, so the
// `||` fallback chains that treated it as absent are replaced by a scan for the
// first valid (integer, non-negative) candidate.
export function chooseWeaponIndex(candidates,fallback=0){for(const candidate of candidates)if(Number.isInteger(candidate)&&candidate>=0)return candidate;return fallback;}
// Bots commit to a chosen weapon for a window so they do not oscillate around a
// distance band boundary. A dry magazine always permits an immediate swap.
export function weaponSwitchAllowed(a,desired,now,commitUntil){if(!Number.isInteger(desired)||desired<0||desired===a.weapon)return false;const empty=!(a.ammo?.[a.weapon]>0);return empty||now>=(commitUntil||0);}

// ---------------------------------------------------------------------------
// NPC area confinement. A spawned NPC may carry an `npcZone` {x,z,r,leash,kind}
// authored by the campaign or by spawnGroup. `patrol`/`hold` zones are hard:
// the actor is never allowed to leave its leash. `spawn` zones are soft: the
// group may break the leash only while actively engaging a nearby player, and
// otherwise clamps its destination and walks itself home.
export function npcZone(a){const z=a?.npcZone;return z&&Number.isFinite(z.x)&&Number.isFinite(z.z)?z:null;}
export function zoneLeash(z){if(Number.isFinite(z?.leash))return z.leash;return Math.max(Number.isFinite(z?.r)?z.r:8,12);}
export function zoneDistance(a,z){return Math.hypot(a.x-z.x,a.z-z.z);}
export function zoneReturnPoint(match,a){
 const z=npcZone(a);if(!z)return null;
 let best=null,bestDistance=Infinity;
 for(const node of match.nav||[]){const distance=Math.hypot(node.x-z.x,node.z-z.z);if(distance<=zoneLeash(z)&&distance<bestDistance){bestDistance=distance;best=node;}}
 if(best)return {x:best.x,y:Number.isFinite(best.y)?best.y:(floorAt(best.x,best.z,match.arena)??0),z:best.z};
 return {x:z.x,y:0,z:z.z};
}
export function clampToZone(point,z){
 if(!point)return point;
 const leash=zoneLeash(z),dx=(Number.isFinite(point.x)?point.x:z.x)-z.x,dz=(Number.isFinite(point.z)?point.z:z.z)-z.z,distance=Math.hypot(dx,dz);
 if(distance<=leash)return point;
 const scale=leash/distance;
 return {...point,x:z.x+dx*scale,z:z.z+dz*scale};
}
export function zoneFreeEngage(match,a,b,behavior){
 const z=npcZone(a);if(!z||z.kind!=='spawn'||!b)return false;
 const target=b.target>=0?match.actors[b.target]:null;
 if(!target||target.health<=0||!(b.memory>0))return false;
 const reach=Math.min(Number.isFinite(behavior?.range?.[1])?behavior.range[1]:8,12)+4;
 return dist(a,target)<=reach;
}
export function confineDestination(match,a,b,behavior){
 const z=npcZone(a);if(!z||!b)return;
 if(zoneFreeEngage(match,a,b,behavior))return;
 if(zoneDistance(a,z)>zoneLeash(z)){const point=zoneReturnPoint(match,a);if(point)b.destination=point;return;}
 if(b.destination)b.destination=clampToZone(b.destination,z);
}

export function zoneSlot(match,a,zone,team){const n=8,index=((a.id%n)+n)%n,defending=zone.owner===team,centerY=()=>Number.isFinite(zone.y)?zone.y:(floorAt(zone.x,zone.z,match.arena)??0),safe=(x,z)=>{const y=floorAt(x,z,match.arena);return y!==null&&!obstructed(x,y,z,RULES.radius*.9,match.arena)?{x,y,z}:null;};let candidate;if(defending){const angle=(index/n)*Math.PI*2+(a.id%3)*.35,radius=Math.max(1.2,(zone.radius||3.5)*.6);candidate={x:zone.x+Math.cos(angle)*radius,z:zone.z+Math.sin(angle)*radius};}else{const pool=teamMode(match.config)&&team!==undefined?match.teamSpawns[team]:match.spawns,spawn=pool[index%pool.length],sx=Array.isArray(spawn)?spawn[0]:spawn.x,sz=Array.isArray(spawn)?spawn[1]:spawn.z,angle=Math.atan2(sz-zone.z,sx-zone.x),spread=(index/n)*Math.PI*1.5-Math.PI*.75,radius=Math.max(1,(zone.radius||3.5)*.55);candidate={x:zone.x+Math.cos(angle+spread)*radius,z:zone.z+Math.sin(angle+spread)*radius};}const point=safe(candidate.x,candidate.z);if(point)return {x:point.x,y:point.y,z:point.z};const center=safe(zone.x,zone.z);if(center)return {x:center.x,y:center.y,z:center.z};let best=null,bestD=Infinity;for(const node of match.nav||[]){const d=Math.hypot(node.x-zone.x,node.z-zone.z),limit=(zone.radius||3.5)+5;if(d>limit||d>=bestD)continue;const spot=safe(node.x,node.z);if(spot){best={x:spot.x,y:spot.y,z:spot.z};bestD=d;}}if(best)return best;for(let ring=1;ring<=4;ring++)for(let i=0;i<n;i++){const ang=(i/n)*Math.PI*2,rad=(zone.radius||3.5)+ring,spot=safe(zone.x+Math.cos(ang)*rad,zone.z+Math.sin(ang)*rad);if(spot)return {x:spot.x,y:spot.y,z:spot.z};}return {x:zone.x,y:centerY(),z:zone.z};}

export function zoneDefense(match,a,owned){if(!owned.length)return null;const mates=match.actors.filter(o=>o.health>0&&o.team===a.team);for(const z of owned){if(match.actors.some(o=>o!==a&&o.health>0&&o.team===a.team&&Math.hypot(o.x-z.x,o.z-z.z)<=z.radius))continue;const mine=Math.hypot(a.x-z.x,a.z-z.z);let closest=true;for(const o of mates){if(o!==a&&Math.hypot(o.x-z.x,o.z-z.z)<mine){closest=false;break;}}if(closest)return z;}return null;}

// Deterministic team objective assignment for zone-control modes. The roster is
// sorted by actor id, a prefix defends owned zones and the remainder attacks
// enemy zones round-robin; contested enemy zones take priority so the squad
// collapses on the fight it is already in. `role` is 'defend', 'attack' or
// 'regroup' (a contested collapse). Pure: identical team/zone state always
// yields the same assignment, so replays and tests are stable.
export function objectiveAssignment(match,a,zones){
 if(!Array.isArray(zones)||!zones.length)return null;
 const mates=match.actors.filter(o=>o.health>0&&o.team===a.team).sort((x,y)=>x.id-y.id);
 const index=Math.max(0,mates.findIndex(o=>o.id===a.id));
 const byId=(x,y)=>String(x.id??'').localeCompare(String(y.id??''));
 const owned=zones.filter(z=>z.owner===a.team).sort(byId);
 const contested=zones.filter(z=>z.contested===true).sort(byId);
 const enemy=zones.filter(z=>z.owner!==a.team).sort(byId);
 const defenders=owned.length===0?0:Math.min(owned.length,Math.max(1,Math.ceil(mates.length/2)));
 if(index<defenders){
  const zone=owned[index%owned.length];
  return {role:'defend',zone,zoneId:zone.id??null,index};
 }
 if(enemy.length){
  const pool=contested.length?contested:enemy;
  const zone=pool[((index-defenders)%pool.length+pool.length)%pool.length];
  return {role:contested.length?'regroup':'attack',zone,zoneId:zone.id??null,index};
 }
 if(owned.length){const zone=owned[index%owned.length];return {role:'defend',zone,zoneId:zone.id??null,index};}
 return {role:'attack',zone:zones[index%zones.length],zoneId:zones[index%zones.length].id??null,index};
}

// Average position of living teammates, used to regroup a scattered squad. The
// centroid is computed over the sorted roster so it is stable frame to frame.
export function teamCentroid(match,a){
 const mates=match.actors.filter(o=>o.health>0&&o.team===a.team).sort((x,y)=>x.id-y.id);
 if(!mates.length)return {x:match.center.x,y:0,z:match.center.z};
 let x=0,z=0;
 for(const mate of mates){x+=mate.x;z+=mate.z;}
 return {x:x/mates.length,y:0,z:z/mates.length};
}

// ---------------------------------------------------------------------------
// Phase 2 class-movement policy. The actor's movement state (game/movement.mjs)
// is plain, documented data, so the policy only reads it and presses the verb's
// own input. Deterministic: cadence comes from `match.time` and the hold window
// from `dt`; no Math.random, no wall clock. The kit's `bot.mobility` style
// decides when the verb is worth spending (engage/escape/route/reposition/hold).
// ---------------------------------------------------------------------------
const KIT_BY_CHARACTER=Object.fromEntries(OPERATOR_KITS.map(kit=>[kit.id,kit]));
const MOBILITY_ATTEMPT_SECONDS=2.5;
export function botMovementIntent(match,a,b,input,dt,targetDistance=Infinity){
 const movement=a.movement;
 if(!movement||movement.enabled!==true)return input;
 if(a.vehicleId!==null||a.zipRide||a.traversalFlight||a.health<=0||(a.active||0)>0)return input;
 const now=Number.isFinite(match.time)?match.time:0;
 if((b.mvHold||0)>0){
  b.mvHold=Math.max(0,b.mvHold-dt);
  if(b.mvHoldKind==='crouch')input.crouch=true;
  else if(b.mvHoldKind==='jump')input.jump=true;
  else if(b.mvHoldKind==='slam')input.slam=true;
  return input;
 }
 if(movement.phase!=='ready'||now<(b.mvAt||0))return input;
 const style=KIT_BY_CHARACTER[a.character]?.bot?.mobility??'hold';
 const verb=movement.verb;
 const press=key=>{input[key]=true;b.mvAt=now+MOBILITY_ATTEMPT_SECONDS;};
 const hold=(kind,seconds)=>{b.mvHoldKind=kind;b.mvHold=seconds;b.mvAt=now+MOBILITY_ATTEMPT_SECONDS;};
 if(verb==='grapple'||verb==='deployable-rope'){
  // Aimed route tools: only when a wall or floor sits inside the verb's reach
  // along the current facing, so a bot does not eat the miss cooldown.
  if(style==='route'&&a.grounded&&(targetDistance>13||b.state==='roam'||b.state==='pursue')){
   const reach=movement.params?.distance??14,hit=match.rayWorld(eye(a),aim(a.yaw,a.pitch),reach);
   if(hit>2&&hit<reach-.5)press('mobility');
  }
  return input;
 }
 if(verb==='blink-step'){
  if(a.grounded&&(targetDistance>10||b.state==='pursue'||b.state==='flank'||b.state==='cover'))press('mobility');
  return input;
 }
 if(verb==='air-dash'||verb==='double-jump'){
  if(!a.grounded&&style==='engage'&&(targetDistance>6||b.state==='pursue'))press('jump');
  return input;
 }
 if(verb==='super-jump'){
  if(a.grounded&&style==='engage'&&targetDistance>10&&(b.state==='engage'||b.state==='flank'||b.state==='pursue'))hold('crouch',(movement.params?.windup??.55)+.05);
  return input;
 }
 if(verb==='hover-jets'){
  if(!a.grounded&&(a.vy<-3.5||(a.vy<0&&Number.isFinite(targetDistance)&&targetDistance<10)))hold('jump',.45);
  return input;
 }
 if(verb==='safety-glide'){
  const overVoid=match.arena.voidY!==undefined&&floorAt(a.x,a.z,match.arena)===null;
  if(!a.grounded&&a.vy<-2&&(overVoid||b.suppressed>0||a.health<a.maxHealth*(b.behavior?.retreat??.4)))hold('jump',.6);
  return input;
 }
 if(verb==='brace-slam'){
  // Brace Slam starts from the ground (movement.mjs VERBS['brace-slam'] rejects
  // `ctx.grounded !== true` and then leaps before driving down), so the intent
  // must fire while planted and in range. The old airborne/descending check
  // could never satisfy the verb and Meta's slam fired zero times per match.
  if(a.grounded&&targetDistance<6)press('slam');
  return input;
 }
 return input;
}

export function botInput(match,a,dt){const b=a.bot,hints=harnessBotHints(a.harness)||{range:[6,16],retreatHealth:.4,power:'hurt'},operator=operatorProfile(a.character),behavior=a.npcType?enemyBehavior(a):botBehavior(a);b.behavior=behavior;b.fired=false;const lethal=match.mutators?.oneShot===true||match.mutators?.instagib===true,retreatAt=clamp(behavior.retreat*.6+(hints.retreatHealth??.4)*.4+(lethal?.18:0),.12,.85);b.think-=dt;b.memory=Math.max(0,b.memory-dt);b.suppressed=Math.max(0,(b.suppressed||0)-dt);b.vehicleCooldown=Math.max(0,(b.vehicleCooldown||0)-dt);b.reaction=Math.max(0,b.reaction-dt);if(a.traversalFlight||a.zipRide)return {};if(a.vehicleId!==null&&a.vehicleSeat==='passenger')return {interact:true};if(a.vehicleId!==null&&a.vehicleSeat==='gunner'){const mounted=match.vehicleById(a.vehicleId);if(!mounted||mounted.driver===null)return {interact:true};}const ride=a.vehicleId===null&&(b.vehicleCooldown||0)<=0&&behavior.vehicle>.32?match.vehicles.find(vehicle=>{const seat=vehicleSeatFor(vehicle);return seat&&seat.role!=='passenger'&&Math.hypot(a.x-vehicle.position.x,a.z-vehicle.position.z)<2.4&&Math.abs(a.y-vehicle.position.y)<(vehicle.config?.flight===true?3.2:2.4);}):null;if(ride&&!match.flagCarrier(a))return {interact:true};
  // LATTICE STRIKE SCOUT (§8, V0b): a first-class spotter walks its scan route
  // and never enters the combat/targeting branch. RNG-free and mode-guarded.
  if(a.isScout===true&&match.config.mode==='cocs')return cocsScoutInput(match,a);
    if(b.think<=0){b.think=clamp((match.difficulty.think+match.random()*.15)*(behavior.thinkScale||1),match.difficulty.think*.6,(match.difficulty.think+.15)*1.4);const candidates=match.actors.filter(t=>t!==a&&t.health>0&&dist(a,t)<(a.botScan||25)&&match.visible(eye(a),eye(t))&&(!(t.powerups?.cloak>0)||dist(a,t)<4)&&(!teamMode(match.config)||t.team!==a.team)),locks=new Map();for(const ally of match.actors)if(ally!==a&&ally.bot&&Number.isInteger(ally.bot.target)&&ally.bot.target>=0)locks.set(ally.bot.target,(locks.get(ally.bot.target)||0)+1);const ranked=candidates.map(t=>{let score=dist(a,t)+match.random()*1.5+(locks.get(t.id)||0)*(2+behavior.hold*7);if(behavior.personality==='opportunist')score+=(t.health||100)*.14;if(behavior.role==='ambusher')score+=Math.max(0,dist(a,t)-9)*1.5;if(match.objectiveState?.kind==='juggernaut'&&t.id===match.objectiveState.juggernautId)score-=18;if(behavior.hold>.7)score+=Math.max(0,behavior.range[1]-dist(a,t))*.4;if(behavior.archetype==='flanker')score+=Math.max(0,dist(a,t)-9)*.25;else if(behavior.archetype==='sharpshooter')score-=Math.min(dist(a,t),26)*.06;else if(behavior.archetype==='rusher')score-=Math.max(0,9-dist(a,t))*.18;else if(behavior.archetype==='defender')score+=Math.max(0,dist(a,t)-13)*.22;else if(behavior.archetype==='support')score+=(t.health||100)*.06;
 // Finish the wounded and punish anyone already shooting a teammate. Both are
 // deterministic (health + distance only) and make target choice less random.
 if(behavior.archetype==='rusher'||behavior.archetype==='flanker')score+=(t.health||100)*.05;
 if(Number.isInteger(t.bot?.threat)&&t.bot.threat===a.id)score-=2.5;
 return {t,score};}).sort((c,d)=>c.score-d.score),target=ranked.length?ranked[0].t:null;if(target){if(b.target!==target.id)b.reaction=match.difficulty.reaction+match.random()*.25;b.target=target.id;b.memory=1.5;b.seen={x:target.x,y:target.y,z:target.z};}else if(!b.memory)b.target=-1;
    const criticalHealth=a.health<a.maxHealth*retreatAt,objectiveMode=['ctf','koth','domination','teamdeathmatch','assault','combined-arms','payload','juggernaut','team-elimination','holdout','uplink','vip-escort','cocs'].includes(match.config.mode),supply=objectiveMode?undefined:match.pickups.filter(p=>!p.wait&&match.useful(a,p)&&(walkEdge(a,p,match.arena)||path(a,p,match.nav,match.edges).length>1)).sort((c,d)=>(dist(a,c)+match.spreadBias(a,c)*4*behavior.supply-(c.kind==='health'&&a.health<a.maxHealth*.55?20:0))-(dist(a,d)+match.spreadBias(a,d)*4*behavior.supply-(d.kind==='health'&&a.health<a.maxHealth*.55?20:0)))[0],healthSupply=objectiveMode?match.pickups.filter(p=>!p.wait&&(p.kind==='health'||p.kind==='megahealth')&&match.useful(a,p)&&dist(a,p)<=8&&(walkEdge(a,p,match.arena)||path(a,p,match.nav,match.edges).length>1)).sort((c,d)=>dist(a,c)-dist(a,d))[0]:undefined,strategicSupply=objectiveMode?match.pickups.filter(p=>!p.wait&&match.useful(a,p)&&(p.kind==='armor'||p.kind==='megahealth'||POWERUPS.some(power=>power.id===p.kind))&&dist(a,p)<=3&&walkEdge(a,p,match.arena)).sort((c,d)=>dist(a,c)-dist(a,d))[0]:undefined,needs=objectiveMode?(criticalHealth&&healthSupply||strategicSupply):(supply&&(criticalHealth||(a.ammo.slice(1).every(n=>n===0)&&supply.kind!=='health')||(a.health<a.maxHealth*.7&&supply.kind==='health')));
     const duel=behavior.objective<.4&&target&&b.target>=0&&b.memory>0&&!needs;
     if(match.config.mode==='ctf'){const carrying=Object.values(match.flags).some(f=>f.carrier===a.id),enemy=match.flags[1-a.team],own=match.flags[a.team],enemyDistance=dist(a,enemy),ownDistance=dist(a,own);if(carrying){b.state='flag-return';b.destination={x:own.x,y:0,z:own.z};}else if(needs){b.state='seek';b.destination=objectiveMode?needs:supply;}else if(behavior.hold>.62&&own.state!=='at-base'){b.state='flag-defend';b.destination={x:own.x,y:0,z:own.z};}else if((own.state==='dropped'||own.carrier!==null)&&(ownDistance<=enemyDistance||behavior.hold>.62)){b.state='flag-defend';b.destination={x:own.x,y:0,z:own.z};}else if(enemy.state==='carried'){b.state='flag-defend';b.destination=match.defensivePost(a);}else{b.state='flag-attack';b.destination=enemyDistance>38||behavior.flank>.7?match.flankDestination(a,enemy):{x:enemy.x,y:0,z:enemy.z};}}else if(needs){b.state='seek';b.destination=objectiveMode?needs:supply;}else if((match.config.mode==='koth'||match.config.mode==='domination'||match.config.mode==='combined-arms'||match.config.mode==='holdout'||match.config.mode==='uplink')&&match.objectiveState){const zones=match.objectiveState.zones,assignment=objectiveAssignment(match,a,zones);if(assignment){const zone=assignment.zone,centroid=teamCentroid(match,a),scattered=dist(a,centroid)>26&&assignment.role!=='defend';b.state=scattered?'regroup':'objective';b.objectiveRole=assignment.role;b.destination=scattered?centroid:match.zoneSlot(a,zone,a.team);}else{const owned=zones.filter(z=>z.owner===a.team),enemyZones=zones.filter(z=>z.owner!==a.team),holdZone=behavior.hold>.62&&owned.length?owned.slice().sort((x,y)=>dist(a,x)-dist(a,y))[0]:null,defendZone=match.zoneDefense(a,owned),pushPool=enemyZones.length?enemyZones:zones,pushZone=pushPool.slice().sort((x,y)=>dist(a,x)-dist(a,y))[0],zone=defendZone||holdZone||pushZone;b.state='objective';b.objectiveRole='attack';b.destination=match.zoneSlot(a,zone,a.team);}}else if(match.config.mode==='cocs'&&match.objectiveState){const assignment=cocsAssignment(match,a,match.objectiveState);if(assignment&&assignment.nodeId){const cocsDestination=cocsBotDestination(match,a,assignment,match.objectiveState);b.state='objective';b.objectiveRole=assignment.kind;b.cocsNode=assignment.nodeId;b.destination=cocsDestination||null;}else{b.state='roam';if(!b.destination||dist(a,b.destination)<2.5)b.destination=match.patrolPoint(a);}}else if(match.config.mode==='assault'&&match.objectiveState&&!duel){const sectors=match.objectiveState.sectors||[],active=sectors[Math.min(match.objectiveState.active??0,Math.max(0,sectors.length-1))];if(active){const defending=a.team===(match.objectiveState.defender??1);b.state=defending?'hold':'objective';b.destination=defending?match.zoneSlot(a,{...active,owner:a.team},a.team):match.zoneSlot(a,active,a.team);}else b.state='roam';}else if(match.config.mode==='payload'&&match.objectiveState&&!duel){const st=match.objectiveState,pos=st.position??payloadPosition(st),attacking=a.team===(st.attacker??0);b.state=attacking?'objective':'hold';b.destination=attacking?match.zoneSlot(a,{id:'payload',x:pos.x,z:pos.z,y:pos.y,radius:st.radius,owner:a.team},a.team):{x:pos.x,y:pos.y,z:pos.z};}else if(match.config.mode==='vip-escort'&&match.objectiveState&&!duel){const st=match.objectiveState,vip=match.actors.find(x=>x.id===st.vipId&&x.health>0),anchor=vip?{x:vip.x,y:vip.y??0,z:vip.z}:{x:st.extract.x,y:st.extract.y??0,z:st.extract.z},escort=a.team===(st.escortTeam??0),vipAtExtract=Boolean(vip)&&Math.hypot(vip.x-st.extract.x,vip.z-st.extract.z)<=st.escortRadius;b.state='objective';b.destination=escort&&vipAtExtract?{x:st.extract.x,y:st.extract.y??0,z:st.extract.z}:anchor;}else if(match.config.mode==='juggernaut'&&match.objectiveState){const st=match.objectiveState,jug=match.actors.find(x=>x.id===st.juggernautId&&x.health>0),zones=st.zones||[];if(a.juggernaut){const zone=zones.slice().sort((x,y)=>dist(a,x)-dist(a,y))[0];b.state='objective';b.destination=zone?match.zoneSlot(a,zone,a.team):{x:match.center.x,y:0,z:match.center.z};}else if(jug){b.state='objective';b.destination=dist(a,jug)>40?match.flankDestination(a,jug):{x:jug.x,y:jug.y??0,z:jug.z};}else{const zone=zones.slice().sort((x,y)=>dist(a,x)-dist(a,y))[0];b.state='roam';b.destination=zone?match.zoneSlot(a,zone,a.team):match.patrolPoint(a);}}else if(match.config.mode==='team-elimination'&&match.objectiveState){const zone=(match.objectiveState.zones||[]).slice().sort((x,y)=>dist(a,x)-dist(a,y))[0];b.state='objective';b.destination=zone?match.zoneSlot(a,zone,a.team):match.patrolPoint(a);}else if(target){if(behavior.flank>.65&&dist(a,target)>12){b.state='flank';b.destination=match.flankDestination(a,target);}else if(behavior.hold>.72&&dist(a,target)>16){b.state='hold';b.destination=match.defensivePost(a);}else{b.state='engage';b.destination={x:target.x,y:target.y,z:target.z};}}else if(b.memory){b.state='pursue';b.destination=b.seen;}else{b.state='roam';if(!b.destination||dist(a,b.destination)<2.5)b.destination=match.patrolPoint(a);}
   if(target&&target.health>0&&b.memory>0&&(b.state==='objective'||b.state==='hold'||b.state==='flag-defend'||b.state==='flag-return'||a.juggernaut)&&(a.health<a.maxHealth*retreatAt||b.suppressed>0)){
    const cover=coverPoint(match,a,target);
    if(cover){b.state='cover';b.destination=cover;b.route=[];}
   }
  if(a.vehicleId===null&&(b.vehicleCooldown||0)<=0&&b.destination&&!match.flagCarrier(a)&&dist(a,b.destination)>30){const rig=match.vehicles.find(vehicle=>{const seat=vehicleSeatFor(vehicle);return seat&&seat.role!=='passenger'&&!vehicleMounted(vehicle,a.id)&&Math.hypot(a.x-vehicle.position.x,a.z-vehicle.position.z)<16&&Math.abs(a.y-vehicle.position.y)<(vehicle.config?.flight===true?20:4);});if(rig)b.destination={x:rig.position.x,y:rig.position.y,z:rig.position.z};}
  if(a.npcZone)confineDestination(match,a,b,behavior);
   if(b.destination){
    // Route caching with staggered replanning: keep a valid route until the
    // destination drifts or the per-bot cache window closes, then recompute.
    const dest=b.destination,replan=!b.routeDest||Math.hypot((dest.x??0)-b.routeDest.x,(dest.z??0)-b.routeDest.z)>1.5||match.time>=(b.routeAt??0);
    if(replan){b.route=path(a,dest,match.nav,match.edges);b.routeAt=match.time+.8+(a.id%4)*.2;b.routeDest={x:dest.x??0,z:dest.z??0};}
    if(b.route.length>1&&dist(a,match.nav[b.route[0]])<2)b.route.shift();
   }
  b.seeking=Boolean(needs);
  }
 const t=match.actors[b.target],canSee=t&&t.health>0&&b.memory>0&&dist(a,t)<(a.botScan||25)&&match.visible(eye(a),eye(t));const routeNode=b.route.length?match.nav[b.route[0]]:null;let dest=b.route.length>1?routeNode:(b.destination||routeNode||a);
 if(canSee&&!b.tracking)b.reaction=Math.max(b.reaction,match.difficulty.reaction+match.random()*.25);
 b.tracking=!!canSee;
  if(dist(a,dest)<.8&&b.route.length&&(b.route.length>1||walkEdge(a,b.destination||a,match.arena))){b.route.shift();dest=b.route.length?match.nav[b.route[0]]:b.destination||a;}
if(b.destination&&walkEdge(a,b.destination,match.arena))dest=b.destination;
else if(!b.route.length&&dest&&!walkEdge(a,dest,match.arena)){const node=match.nav[nearest(a,match.nav)];dest=node&&dist(a,node)>1?node:null;}
let delta=dest?v(dest.x-a.x,0,dest.z-a.z):v(0,0,0),l=Math.hypot(delta.x,delta.z);let input=l>.4?{x:delta.x/l,z:delta.z/l}:{};
  if(canSee){const d=dist(a,t),desperate=(a.health<a.maxHealth*retreatAt||b.suppressed>0)&&!b.seeking,unsafeBlast=blastUnsafe(WEAPONS[a.weapon],d),band=behavior.range,hold=behavior.hold>.62,inner=clamp(behavior.engageBand[0],band[0],band[1]),outer=clamp(behavior.engageBand[1],inner,band[1]),fresh=(hold?outer:inner+(1-behavior.aggression)*1.8)+(desperate?5:0);if(desperate||!Number.isFinite(b.standoff)||Math.abs(d-b.standoff)>1.25)b.standoff=fresh;const desired=b.standoff,closing=unsafeBlast||desperate?-1:d>desired+1?1:d<desired-1?-.7:0,toward=norm(v(t.x-a.x,0,t.z-a.z)),period=Math.max(.5,behavior.strafePeriod||2),phase=behavior.strafePhase||0;let side;if(behavior.strafePattern===1)side=Math.floor((match.time+phase)/period)%2===0?1:-1;else if(behavior.strafePattern===2)side=Math.sin((match.time+phase)*(1.6+behavior.strafe*1.4))>=0?1:-1;else side=Math.sin(match.time*(1.3+behavior.strafe)+a.id*1.7)>0?1:-1;if(b.strafeReverse>-99&&match.time-b.strafeReverse<.4)side=-side;const strafe=behavior.strafe*(behavior.aggression>.65?.85:.55),combat={x:toward.x*closing+toward.z*side*strafe,z:toward.z*closing-toward.x*side*strafe};input=l>.4&&b.state!=='engage'&&b.state!=='hold'?{x:delta.x/l+combat.x*.35,z:delta.z/l+combat.z*.35}:combat;
    // Mode loadouts restrict the candidate pool before archetype/harness
    // preferences vote, so a sniper-only mode never has a bot reach for an SMG.
    const allowed=index=>loadoutAllows(match.loadout,index),available=WEAPONS.map((w,index)=>a.ammo[index]>0&&allowed(index)?index:-1).filter(index=>index>=0),preferred=preferredHarnessWeapon(a.harness,available),operatorWeapon=preferredOperatorWeapon(a.character,available),far=behavior.range[1],bandInReach=(behavior.weaponBand==='close'&&d<12)||(behavior.weaponBand==='mid'&&d>=8&&d<=26)||(behavior.weaponBand==='long'&&d>16),bandWeapon=bandInReach?botWeaponBandPick(a.ammo,behavior.weaponBand):-1,ladderWeapon=d<8?(a.ammo[9]>0?9:a.ammo[3]>0?3:-1):d>20&&a.ammo[8]>0?8:d>14&&a.ammo[2]>0?2:d>5&&d<16&&a.ammo[1]>0?1:a.ammo[7]>0?7:a.ammo[5]>0?5:a.ammo[4]>0?4:a.ammo[6]>0?6:-1,rangeWeapon=bandWeapon>=0?bandWeapon:ladderWeapon;
     const pinned=modeWeapon(match.config,match.loadout);let weaponDesired=-1;
     if(pinned!==null)weaponDesired=pinned;
     else if(match.mutators.mirrorLoadout&&loadoutAllows(match.loadout,match.config.startingWeapon))weaponDesired=match.config.startingWeapon;
     else if(match.config.mode==='armsrace'||match.mutators.randomLoadout)weaponDesired=Number.isInteger(a.weapon)?a.weapon:-1;
     else weaponDesired=chooseWeaponIndex([rangeWeapon,preferred,operatorWeapon,loadoutStart(match.config,match.loadout)],0);
     if(weaponSwitchAllowed(a,weaponDesired,match.time,b.weaponCommitUntil)&&match.switchWeapon(a,weaponDesired,{source:'bot'}))b.weaponCommitUntil=match.time+2.5;
 b.aimWait=(b.aimWait||0)-dt;
 if(b.aimWait<=0){const err=match.difficulty.error*(1+match.random()*.89)*(b.suppressed>0?1.9:1);b.aimError=v((match.random()-.5)*err,(match.random()-.5)*err,(match.random()-.5)*err);b.aimWait=match.difficulty.think;}
 const lead=WEAPONS[a.weapon].speed?d/WEAPONS[a.weapon].speed:0,dir=norm(v(t.x+t.vx*lead-a.x+d*b.aimError.x,t.y+1.1-(a.y+1.45)+d*b.aimError.y,t.z+t.vz*lead-a.z+d*b.aimError.z));
 const turn=match.difficulty.id==='easy'?2.5:match.difficulty.id==='normal'?4:8,yaw=Math.atan2(-dir.x,-dir.z),pitch=Math.asin(dir.y),deltaYaw=Math.atan2(Math.sin(yaw-a.yaw),Math.cos(yaw-a.yaw));
 a.yaw+=clamp(deltaYaw,-turn*dt,turn*dt);a.pitch+=clamp(pitch-a.pitch,-turn*dt,turn*dt);
   if(!behavior.meleeOnly&&!b.reaction&&!unsafeBlast&&a.vehicleId===null&&Math.abs(deltaYaw)<.2&&Math.abs(pitch-a.pitch)<.2){if(match.fire(a))b.fired=true;}if(!behavior.meleeOnly&&a.vehicleId===null&&(a.grenadeCooldown||0)<=0&&a.grounded&&d>7&&d<20)match.throwGrenade(a);if(d<=(behavior.meleeRange||2.2)&&!a.melee)input.melee=true;
   const nearby=match.actors.filter(enemy=>enemy!==a&&enemy.health>0&&(!teamMode(match.config)||enemy.team!==a.team)&&dist(a,enemy)<(hints.range[1]||16)).length,shouldPower=hints.power==='close'?d<4.5:hints.power==='escape'?d>8:hints.power==='visible'?d<far&&a.ammo[a.weapon]>2:hints.power==='hurt'?a.health<a.maxHealth*retreatAt:hints.power==='approach'?d>9:hints.power==='cluster'?(d<7||nearby>1):d<far;
    if(!a.cooldown&&shouldPower)match.power(a);
    if(a.juggernaut&&!a.cooldown&&t&&dist(a,t)<(behavior.range[1]||20))match.power(a);
 }else if(l>.2){const roamTurn=(match.difficulty.id==='easy'?2.5:match.difficulty.id==='normal'?4:8);a.yaw=turnToward(a.yaw,Math.atan2(-delta.x,-delta.z),roamTurn*dt);}
 // LATTICE STRIKE stance: keep the fight on the point. When a cocs-assigned
 // bot is engaged, bias its combat movement back toward the assigned node
 // centre so a long weapon standoff cannot pull both teams just outside the
 // capture radius. Mode-guarded; no other mode reaches this branch.
 if(match.config.mode==='cocs'&&b.cocsNode&&b.state==='objective'){
  const node=(match.objectiveState?.nodes||[]).find(entry=>entry.id===b.cocsNode);
  if(node){const dx=node.x-a.x,dz=node.z-a.z,centre=Math.hypot(dx,dz);if(centre>.05){const comfort=node.r*.35,pull=centre>comfort?1.6:.6;input.x=(input.x||0)*.35+dx/centre*pull;input.z=(input.z||0)*.35+dz/centre*pull;const centred=Math.hypot(input.x||0,input.z||0);if(centred>1e-4){input.x/=centred;input.z/=centred;}}if(canSee&&Number.isFinite(b.standoff))b.standoff=Math.min(b.standoff,node.r*.4);}
 }
 const sep=a.grounded?match.separation(a,behavior.spacing):{x:0,z:0};if(sep.x||sep.z){input.x=(input.x||0)+sep.x*.95;input.z=(input.z||0)+sep.z*.95;}const inputLength=Math.hypot(input.x||0,input.z||0);if(inputLength>1e-4){input.x/=inputLength;input.z/=inputLength;}
 if(a.npcZone&&!zoneFreeEngage(match,a,b,behavior)){const zone=a.npcZone,leash=zoneLeash(zone),distance=zoneDistance(a,zone),dx=zone.x-a.x,dz=zone.z-a.z,length=Math.hypot(dx,dz)||1,nextX=a.x+(input.x||0)*1.2,nextZ=a.z+(input.z||0)*1.2;if(distance>leash||Math.hypot(nextX-zone.x,nextZ-zone.z)>leash){input.x=dx/length;input.z=dz/length;}}
const postured=Math.hypot(input.x||0,input.z||0)>.1;if(postured){input.sprint=!a.crouching&&(!canSee||dist(a,canSee?t:(b.destination||a))>22);if(!canSee&&a.health<a.maxHealth*retreatAt&&a.grounded&&(a.slideCooldown||0)<=0&&Math.hypot(a.vx||0,a.vz||0)>6)input.crouch=true;}if(canSee&&!input.sprint){const range=dist(a,t);input.ads=range>9&&range<34&&(a.ammo?.[a.weapon]??0)>0;}
 if(dest&&(dest.y||0)>(a.y||0)+.35&&(dest.y||0)<=(a.y||0)+1.8&&dist(a,dest)<4.5&&a.grounded&&a.vehicleId===null)input.jump=true;
 b.stuck+=dt;if(b.stuck>1.3){if(dist(a,b.last)<.35){const zoneEscape=npcZone(a)?zoneReturnPoint(match,a):null;b.route=[];b.destination=zoneEscape||match.nav[Math.floor(match.random()*match.nav.length)];b.recover=.6;b.think=0;}b.last=v(a.x,a.y,a.z);b.stuck=0;}
 if(b.recover>0){b.recover-=dt;input={x:Math.sin(a.id*2+match.time),z:Math.cos(a.id*2+match.time),jump:true};}
 if(match.arena.voidY!==undefined&&b.recover<=0&&a.grounded&&a.vehicleId===null&&(input.x||input.z)){const len=Math.hypot(input.x,input.z)||1;if(floorAt(a.x+input.x/len*.9,a.z+input.z/len*.9,match.arena)===null)input={};}
 if(match.arena.voidY!==undefined&&!a.grounded&&a.vy<0&&a.vehicleId===null&&floorAt(a.x,a.z,match.arena)===null){const node=match.nav[nearest(a,match.nav)];if(node){const dx=node.x-a.x,dz=node.z-a.z,l=Math.hypot(dx,dz)||1;input={x:dx/l,z:dz/l};}}
 botMovementIntent(match,a,b,input,dt,canSee&&t?dist(a,t):Infinity);
 return input;}

function heapPush(heap,item,priority){heap.push({item,priority});let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p].priority<=heap[i].priority)break;const swap=heap[p];heap[p]=heap[i];heap[i]=swap;i=p;}}
function heapPop(heap){const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;for(;;){const l=i*2+1,r=l+1;let m=i;if(l<heap.length&&heap[l].priority<heap[m].priority)m=l;if(r<heap.length&&heap[r].priority<heap[m].priority)m=r;if(m===i)break;const swap=heap[m];heap[m]=heap[i];heap[i]=swap;i=m;}}return top;}
// Weighted A* over the nav graph: distance-based edge costs with a straight-line
// (admissible) heuristic. Returns an explicit reachability result so a one-node
// route is never mistaken for success.
export function astar(a,b,nodes,edges){
 if(!Array.isArray(nodes)||!nodes.length||!Array.isArray(edges))return {route:[],cost:Infinity,reachable:false};
 const from=nearest(a,nodes),to=nearest(b,nodes),heuristic=i=>Math.hypot(nodes[i].x-nodes[to].x,nodes[i].z-nodes[to].z);
 const g=new Array(nodes.length).fill(Infinity),prev=new Array(nodes.length).fill(-1),closed=new Uint8Array(nodes.length);
 g[from]=0;const heap=[];heapPush(heap,from,heuristic(from));
 while(heap.length){
  const current=heapPop(heap).item;
  if(closed[current])continue;closed[current]=1;
  if(current===to)break;
  for(const next of edges[current]||[]){
   if(closed[next]||!Number.isInteger(next)||next<0||next>=nodes.length)continue;
   const step=Math.hypot(nodes[current].x-nodes[next].x,nodes[current].z-nodes[next].z),tentative=g[current]+step;
   if(tentative<g[next]){g[next]=tentative;prev[next]=current;heapPush(heap,next,tentative+heuristic(next));}
  }
 }
 if(!Number.isFinite(g[to]))return {route:[],cost:Infinity,reachable:false};
 const route=[];for(let node=to;node!==-1;node=prev[node])route.unshift(node);
 return {route,cost:g[to],reachable:true};
}
// Route as a node-index list. An unreachable destination returns an empty route
// rather than a misleading single-node success.
export function path(a,b,nodes,edges){const result=astar(a,b,nodes,edges);return result.reachable?result.route:[];}
