// Snapshot-only tactical map presentation. No simulation state or command queue
// is mutated here. In particular, actors[] is NOT an enemy-intel allow-list.
const list = value => Array.isArray(value) ? value : [];
const finite = Number.isFinite;
const point = value => value && finite(value.x) && finite(value.z);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const word = value => String(value ?? '').replace(/[-_]/g, ' ');
const n = value => Math.round(value * 100) / 100;
const rect = b => b && [b.minX,b.maxX,b.minZ,b.maxZ].every(finite) && b.maxX > b.minX && b.maxZ > b.minZ;
const footprint = b => point(b) && finite(b.w) && finite(b.d) && b.w > 0 && b.d > 0;
const footprintPath = b => `M${n(b.x-b.w/2)},${n(b.z-b.d/2)}h${n(b.w)}v${n(b.d)}h${n(-b.w)}Z`;
const elevationFill = elevation => `hsl(192 18% ${clamp(19+clamp(Math.floor(elevation/3),-4,12)*2,12,43)}%)`;
const geometryCache = new WeakMap();
const emptyMap = Object.freeze({});
export const TACTICAL_MARKER_LIMITS = Object.freeze({friendly:48, enemy:24, objectives:64});

/** Closed views do no descriptor work, even when an unseen map changes. Weak
 * keys retain descriptors across reopen/map switches without retaining maps. */
export function tacticalMapGeometryForView(map, open) {
  if (!open) return null;
  const source=map && typeof map==='object'?map:emptyMap;
  if (!geometryCache.has(source)) geometryCache.set(source,tacticalMapGeometry(source));
  return geometryCache.get(source);
}

/** Build once per immutable map, not once per HUD snapshot. Terrain triangles
 * are batched into height-band paths; even Foundry has only a few SVG elements. */
export function tacticalMapGeometry(map = {}) {
  let bounds = rect(map.bounds) ? map.bounds : rect(map.playBounds) ? map.playBounds : null;
  const blocks = list(map.blocks).filter(footprint);
  // Match.floorAt uses y/topY as the walkable surface, not slab thickness.
  const platforms = list(map.platforms??map.surfaces).filter(footprint)
    .filter(p=>finite(p.y??p.topY??0))
    .map((p,i)=>({id:`platform-${i}`,x:p.x,z:p.z,w:p.w,d:p.d,elevation:p.y??p.topY??0,
      label:String(p.label??(p.route?`${word(p.route)} platform`:'Platform')),path:footprintPath(p),fill:elevationFill(p.y??p.topY??0)}))
    .sort((a,b)=>a.elevation-b.elevation);
  if (!bounds) {
    bounds = {minX:-15,maxX:15,minZ:-15,maxZ:15};
    for (const b of [...blocks,...platforms]) {
      bounds.minX = Math.min(bounds.minX,b.x-b.w/2); bounds.maxX = Math.max(bounds.maxX,b.x+b.w/2);
      bounds.minZ = Math.min(bounds.minZ,b.z-b.d/2); bounds.maxZ = Math.max(bounds.maxZ,b.z+b.d/2);
    }
  }
  const width = bounds.maxX-bounds.minX, height = bounds.maxZ-bounds.minZ;
  const bands = new Map();
  const append = (elevation, path) => {
    const band = clamp(Math.floor(elevation/3),-4,12);
    if (!bands.has(band)) bands.set(band,[]);
    bands.get(band).push(path);
  };
  let triangles = 0;
  for (const surface of list(map.terrain?.surfaces)) {
    const vertices = list(surface?.vertices);
    const indices = surface?.triangles ?? vertices.slice(2).map((_,i) => [0,i+1,i+2]);
    for (const ids of list(indices)) {
      if (++triangles > 60000) break;
      const vertices3 = list(ids).map(i => vertices[i]);
      if (vertices3.length !== 3 || !vertices3.every(v => Array.isArray(v) && v.length >= 3 && v.slice(0,3).every(finite))) continue;
      const [a,b,c] = vertices3;
      if (Math.abs((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2])) < .00001) continue;
      append((a[1]+b[1]+c[1])/3,`M${n(a[0])},${n(a[2])}L${n(b[0])},${n(b[2])}L${n(c[0])},${n(c[2])}Z`);
    }
    if (triangles > 60000) break;
  }
  // Procedural height-only maps: bounded coarse relief sampling, once per map.
  if (!bands.size && typeof map.terrain?.height === 'function') {
    for (let x=0;x<24;x++) for (let z=0;z<24;z++) {
      const px=bounds.minX+x*width/24,pz=bounds.minZ+z*height/24;
      const elevation=map.terrain.height(px+width/48,pz+height/48);
      if (finite(elevation)) append(elevation,`M${n(px)},${n(pz)}h${n(width/24)}v${n(height/24)}h${n(-width/24)}Z`);
    }
  }
  const terrain = [...bands].sort(([a],[b])=>a-b).map(([band,paths])=>({band,path:paths.join(''),fill:elevationFill(band*3)}));
  const solids = blocks.map(footprintPath).join('');
  const nodes = list(map.nodes).filter(point);
  const links = list(map.lattice).flatMap(edge => {
    const a=nodes.find(node=>node.id===edge?.[0]),b=nodes.find(node=>node.id===edge?.[1]);
    return a && b ? [{a,b}] : [];
  });
  const lanes = list(map.lanes).flatMap(lane => [lane.waypoints,...list(lane.variants)].flatMap((route,index)=> {
    const points=list(route).filter(p=>Array.isArray(p)&&finite(p[0])&&finite(p[1]));
    return points.length<2?[]:[{id:`${lane.id}-${index}`,label:word(lane.id),kind:word(lane.kind),points:points.map(p=>`${p[0]},${p[1]}`).join(' ')}];
  }));
  const landmarks = list(map.landmarks).filter(point).slice(0,32).map((p,i)=>({...p,id:`landmark-${i}`,label:String(p.label??p.name??'Landmark')}));
  const facilities = [
    ...list(map.terminals).map(p=>({...p,kind:'terminal'})),
    ...list(map.depots).map(p=>({...p,kind:'depot'})),
    ...list(map.traversal).map(p=>({...p,...p.from,kind:p.kind??'transit'})),
  ].filter(point).slice(0,40).map((p,i)=>({...p,id:`facility-${i}`,label:word(p.label??p.id??p.kind)}));
  const voidOutside=platforms.length>0||Boolean(map.terrain);
  return {bounds,width,height,terrain,platforms,voidOutside,solids,links,lanes,landmarks,facilities};
}

const ownerLabel = (owner, team) => owner === 0 || owner === 1 ? (owner===team?'Friendly':'Enemy') : 'Neutral';

/** Public objective truth, including non-LATTICE modes and mission waypoints. */
export function tacticalObjectives(hud = {}, map = {}, player = {}, command = null) {
  const result=[];
  const add=(entry,kind,id,label,status='')=>{
    if (!point(entry) || result.length>=TACTICAL_MARKER_LIMITS.objectives) return;
    result.push({id:String(id),nodeId:kind==='node'?String(entry.id):null,kind,x:entry.x,z:entry.z,
      radius:finite(entry.r??entry.radius)?Math.max(0,entry.r??entry.radius):0,
      label:String(label),status,owner:entry.owner??entry.team??null,contested:entry.contested===true});
  };
  const nodes=list(hud.cocs?.nodes);
  for (const node of nodes) {
    const authored=list(map.nodes).find(n=>n.id===node.id);
    const view=list(command?.model?.nodes).find(n=>n.id===node.id)??list(command?.board?.nodes).find(n=>n.id===node.id);
    const status=[ownerLabel(node.owner,player.team),node.contested?'Contested':node.live?'Live front':'',view?.reason?word(view.reason):''].filter(Boolean).join(' · ');
    add({...authored,...node},'node',node.id,view?.label??node.label??authored?.label??word(node.id),status);
  }
  if (!nodes.length) {
    for (const [i,zone] of list(hud.objectives?.zones).entries()) add(zone,'zone',`zone-${zone.id??i}`,zone.label??word(zone.id??`Zone ${i+1}`),`${ownerLabel(zone.owner,player.team)}${zone.contested?' · Contested':''}`);
    // Authored capture areas remain useful before a mode has a live zone model.
    if (!list(hud.objectives?.zones).length && ['domination','koth'].includes(hud.config?.mode)) {
      for (const [i,zone] of list(map.objectiveZones).entries()) add(zone,'zone',`zone-${i}`,zone.label??`Zone ${i+1}`,'Capture area');
    }
  }
  for (const [i,flag] of list(hud.flags).entries()) add(flag,'flag',`flag-${i}`,`Team ${flag.team??i} flag`,String(flag.state??(flag.carrier!=null?'Carried':'At base')));
  const payload=hud.objectives?.kind==='payload'?(hud.objectives.payload??hud.objectives):null;
  if (payload?.position) add(payload.position,'payload','payload','Payload',payload.delivered?'Delivered':payload.contested?'Contested':`${Math.round(payload.progress??0)}% delivered`);
  const waypoint=hud.singleplayer?.waypoint;
  if (waypoint) add(waypoint,'waypoint','waypoint',waypoint.label??'Mission waypoint','Current mission objective');
  for (const [i,marker] of list(hud.markers).entries()) add(marker,'marker',`marker-${marker.id??i}`,marker.label??'Objective',marker.detail??'');
  return result;
}

/** Only team-friendly actors and already-published intel. Never recover an
 * enemy position from actors[] by id, including for last-seen SPOT records. */
export function tacticalActors(hud = {}, player = {}, radar = null) {
  const team=player.team,viewer=hud.spectate!==true&&(team===0||team===1);
  const friendly=[],enemy=[],seen=new Set();
  const membership=new Map();
  if (viewer) for (const squad of list(hud.cocs?.squadBoard?.[team]?.squads)) {
    if (squad?.team!==team) continue;
    for (const id of list(squad.members)) membership.set(String(id),{squadId:String(squad.id),squadName:String(squad.name??squad.id),squadLeader:String(squad.leader)===String(id)});
  }
  const squadLabel=(id,base)=>{
    const squad=membership.get(String(id));
    return {squadId:null,squadName:null,squadLeader:false,...squad,
      label:squad?`${base} · ${squad.squadName} squad${squad.squadLeader?' · leader':''}`:base};
  };
  if (point(player)) friendly.push({id:`self-${player.id}`,x:player.x,z:player.z,
    ...squadLabel(player.id,hud.spectate?'Following':player.health>0?'You':'You · respawning'),self:true,yaw:finite(player.yaw)?player.yaw:0});
  if (viewer) for (const actor of list(hud.actors)) {
    if (friendly.length>=TACTICAL_MARKER_LIMITS.friendly) break;
    if (actor.id===player.id || actor.team!==team || !(actor.health>0) || !point(actor)) continue;
    const role=actor.subagentRole??(actor.isScout?'scout':null);
    friendly.push({id:`ally-${actor.id}`,x:actor.x,z:actor.z,
      ...squadLabel(actor.id,`${actor.name??'Ally'}${role?` · ${word(role)}`:''}`),self:false,yaw:0});
  }
  const addEnemy=(p,id,label)=>{
    if (!point(p)||seen.has(String(id))||enemy.length>=TACTICAL_MARKER_LIMITS.enemy) return;
    seen.add(String(id));enemy.push({id:`intel-${id}`,x:p.x,z:p.z,label});
  };
  if (viewer && hud.cocs) {
    const tick=hud.cocs.tick;
    if (finite(tick)) {
      for (const spot of list(hud.cocs.spots)) if (spot.team===team&&finite(spot.until)&&spot.until>tick) addEnemy(spot,spot.id,'Enemy · last spotted position');
      for (const [id,intel] of Object.entries(hud.cocs.fieldSupport?.intel?.[team]??{})) if (finite(intel?.until)&&intel.until>tick) addEnemy(intel,id,'Enemy · revealed position');
    }
    // Do not use contacts[team] as a fallback: V1 contacts may share other
    // teams' SPOT marks and carry newer actor coordinates. The own-team timed
    // sources above contain the actual published last-known positions.
  } else if (!hud.cocs && hud.spectate!==true && point(player) && finite(radar?.range)) {
    // Preserve the existing radar's visibility/range/cloak decisions. Clamped
    // contacts have lost world distance and must not become fabricated pins.
    const yaw=finite(player.yaw)?player.yaw:0,cos=Math.cos(yaw),sin=Math.sin(yaw);
    for (const contact of list(radar.contacts)) {
      if (contact.kind!=='actor'||contact.self||contact.dead||contact.offscreen||contact.revealed||!finite(contact.x)||!finite(contact.y)) continue;
      if (viewer && contact.team===team) continue;
      const right=contact.x*radar.range,forward=contact.y*radar.range;
      addEnemy({x:player.x+right*cos-forward*sin,z:player.z-right*sin-forward*cos},contact.id,'Enemy · radar contact');
    }
  }
  return {friendly,enemy};
}

/** The map narrows command access to the actual command-seat holder. The
 * simulation/server and issueCocsOrder still make the final authorization. */
export function tacticalCommandGate(hud, player, command) {
  if (!command?.strip) return {allowed:false,reason:'Objective overview'};
  if (hud?.spectate===true||command.spectate===true) return {allowed:false,reason:'Spectator overview'};
  if (hud?.over===true) return {allowed:false,reason:'Match complete'};
  if (!(player?.health>0)) return {allowed:false,reason:'Orders available when alive'};
  if (command.commander?.mine!==true) return {allowed:false,reason:'Map orders require the command seat'};
  if (![command.armCocsVerb,command.pickCocsTarget,command.issueCocsOrder].every(fn=>typeof fn==='function')) return {allowed:false,reason:'Command connection unavailable'};
  return {allowed:true,reason:'Commander · select a verb, select a node, issue'};
}

/** Position commands use the nearest node from the CURRENT legal target set.
 * The engine accepts node ids, never free-form coordinates. Ties preserve the
 * authority's target ranking. */
export function tacticalNearestTarget(position, targets) {
  if (!point(position)) return null;
  let nearest=null,distance=Infinity;
  for (const target of list(targets)) {
    if (!point(target)||target.id===null||target.id===undefined) continue;
    const d=Math.hypot(target.x-position.x,target.z-position.z);
    if (d<distance) {nearest=target;distance=d;}
  }
  return nearest;
}
