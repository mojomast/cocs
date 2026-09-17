// Small per-match cache: actual navigation travel, not straight-line distance
// through walls. Computed once per authored spawn source, never per render frame.
export function routeDistances(nodes,edges,source){
 const d=new Float64Array(nodes.length);d.fill(Infinity);if(source<0||source>=nodes.length)return d;
 const visited=new Uint8Array(nodes.length);d[source]=0;
 for(let n=0;n<nodes.length;n++){let u=-1,best=Infinity;for(let i=0;i<d.length;i++)if(!visited[i]&&d[i]<best){best=d[i];u=i;}if(u<0)break;visited[u]=1;const a=nodes[u];for(const v of edges[u]||[]){const b=nodes[v];if(!b)continue;const cost=Math.hypot(a.x-b.x,(a.y||0)-(b.y||0),a.z-b.z);if(d[u]+cost<d[v])d[v]=d[u]+cost;}}
 return d;
}
export function nearestRouteNode(point,nodes){let best=-1,distance=Infinity;for(let i=0;i<nodes.length;i++){const p=nodes[i],d=Math.hypot(p.x-point.x,(p.y||0)-(point.y||0),p.z-point.z);if(d<distance){best=i;distance=d;}}return {index:best,distance};}
export function spawnRouteContext(match,point){
 const nodes=match.nav||[],edges=match.edges||[],source=nearestRouteNode(point,nodes);
 if(source.index<0||source.distance>4)return null;
 const cache=match._spawnRouteCache??=new Map();
 let distances=cache.get(source.index);if(!distances){distances=routeDistances(nodes,edges,source.index);if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(source.index,distances);}
 return {travel(target){const dest=nearestRouteNode(target,nodes);if(dest.index<0||dest.distance>5)return null;const d=distances[dest.index];return Number.isFinite(d)?d+source.distance+dest.distance:null;}};
}
export function contestedPickupPenalty(point,pickups,enemies,route){
 if(!route||!enemies.length)return 0;
 let penalty=0;
 for(const p of pickups||[]){if(p.wait>0||!['rocket','rail','overshield','overcharge','megahealth'].includes(p.kind))continue;const travel=route.travel(p);if(travel===null||travel>7)continue;
  // Only penalize a reward already under hostile pressure. Quiet recovery
  // supplies do not turn a safe spawn into a bad one.
  if(enemies.some(e=>Math.hypot(e.x-p.x,(e.y||0)-(p.y||0),e.z-p.z)<14))penalty=Math.max(penalty,(7-travel)*1.8);
 }
 return penalty;
}
