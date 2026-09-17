// Campaign-only placement contract. Coordinates are FLOOR coordinates, never
// tunnel centres. The shared navigation graph supplies authoritative floor Y.
// Fail loudly on map drift rather than silently place a required enemy off-route.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function flood(edges,start){
 const seen=new Set([start]),queue=[start];
 for(let i=0;i<queue.length;i++)for(const next of edges[queue[i]]||[])if(!seen.has(next)){seen.add(next);queue.push(next);}
 return seen;
}
export function campaignReachable(match,entrance){
 const nodes=match.nav||[],edges=match.edges||[];
 const start=nodes.indexOf(entrance);
 if(start<0)throw new Error('Campaign entrance is not on navigation');
 const forward=flood(edges,start),reverse=nodes.map(()=>[]);
 edges.forEach((links,i)=>links.forEach(j=>reverse[j]?.push(i)));
 const backward=flood(reverse,start);
 return nodes.filter((_,i)=>forward.has(i)&&backward.has(i));
}
function candidates(nodes,point){
 return nodes.filter(n=>Number.isFinite(n.y)&&distance(n,point)<=(point.maxSnap??5)&&
  n.y>=(point.minY??-Infinity)&&n.y<=(point.maxY??Infinity)&&
  (!Number.isFinite(point.y)||Math.abs(n.y-point.y)<=(point.maxRise??1)))
  .sort((a,b)=>distance(a,point)-distance(b,point)||a.x-b.x||a.z-b.z);
}
export function resolveCampaignAnchors(match,mission){
 const entrance=candidates(match.nav,mission.anchors.entrance)[0];
 if(!entrance)throw new Error(`${mission.id}: entrance has no supported floor`);
 const reachable=campaignReachable(match,entrance),anchors={};
 for(const [name,spec] of Object.entries(mission.anchors)){
  const node=candidates(reachable,spec)[0];
  if(!node)throw new Error(`${mission.id}: anchor ${name} is unreachable or outside floor bounds`);
  anchors[name]={...spec,...node,anchor:name};
 }
 return {anchors,reachable};
}
export function campaignPoint(anchors,point){
 if(!point?.anchor)return point;
 const anchor=anchors[point.anchor];
 if(!anchor)throw new Error(`Unknown campaign anchor: ${point.anchor}`);
 return {...anchor,...point,x:anchor.x,y:anchor.y,z:anchor.z};
}
export function campaignGroupPoints(match,state,request,count){
 const point=campaignPoint(state.anchors,request),r=request.radius??6;
 const nodes=state.campaignReachable.filter(n=>distance(n,point)<=r&&Math.abs(n.y-point.y)<=1.25)
  .sort((a,b)=>distance(a,point)-distance(b,point)||a.x-b.x||a.z-b.z);
 const chosen=[];
 for(const node of nodes){
  if(chosen.some(p=>distance(p,node)<1.5)||match.actors.some(a=>a.health>0&&distance(a,node)<1.5))continue;
  chosen.push(node);if(chosen.length===count)break;
 }
 if(chosen.length<count)throw new Error(`Campaign group ${request.group} needs ${count} reachable floor slots at ${request.anchor}; found ${chosen.length}`);
 return chosen;
}
