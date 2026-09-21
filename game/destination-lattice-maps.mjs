// Destination theatres use the same seven-node / five-capturable contract as
// Lattice Foundry. Registries are deliberately owned by the integrating caller.
// All geometry is deterministic; surface materials and prop families use the
// renderer's existing procedural/MOTH overrides without requiring a bake.
import {freeze,node,edge,lane,terminal,teamSpawns,flagSpawns,zone} from './map-schema.mjs';
import {ensureFloorLattice,floorHeightAtLattice} from './floor-lattice.mjs';

const bounds={minX:-120,maxX:120,minZ:-80,maxZ:80};
const clamp=n=>Math.max(0,Math.min(1,n));
const rotate=points=>points.map(([x,z])=>[-x,-z]);
const paired=items=>items.flatMap(p=>[p,{...p,x:-p.x,z:-p.z,id:`${p.id}-east`}]);
const point=(x,z,y=0)=>({x,z,y});
const deck=(id,x,z,length,width,rise,ramp)=>({id,x,z,length,width,rise,ramp});
const links=[edge('hq-0','front-0'),edge('hq-1','front-1'),
 edge('front-0','relay-0'),edge('relay-0','front-1'),
 edge('front-0','econ-n'),edge('front-1','econ-n'),edge('relay-0','econ-n'),
 edge('front-0','econ-s'),edge('front-1','econ-s'),edge('relay-0','econ-s')];

// Filled service wings: top, ramps and retaining faces all use authoritative
// terrain triangles. There are no decorative roofs above unsupported space.
// Four-metre boundaries align every ramp toe, shoulder and platform edge.
function theatreTerrain(theme,decks){
 const surfaces=new Map();
 const surface=(material,walkable)=>{
  const id=`${material}-${walkable?'floor':'retaining'}`;
  if(!surfaces.has(id))surfaces.set(id,{id,material,walkable,vertices:[],triangles:[]});
  return surfaces.get(id);
 };
 const tri=(points,material,walkable=true)=>{
  const s=surface(material,walkable),i=s.vertices.length;
  s.vertices.push(...points);s.triangles.push([i,i+1,i+2]);
 };
 const quad=(p,material,walkable=true)=>{
  tri([p[0],p[1],p[2]],material,walkable);tri([p[0],p[2],p[3]],material,walkable);
 };
 const height=(d,x)=>d.rise*clamp((d.length/2+d.ramp-Math.abs(x-d.x))/d.ramp);
 for(let x=bounds.minX;x<bounds.maxX;x+=4)for(let z=bounds.minZ;z<bounds.maxZ;z+=4){
  const d=decks.find(d=>Math.abs(x+2-d.x)<d.length/2+d.ramp&&Math.abs(z+2-d.z)<d.width/2);
  const y=a=>d?height(d,a):0;
  const radial=Math.hypot(x+2,z+2);
  const material=d?'metal':theme==='orbital'&&radial>14&&radial<20?'metal':
   Math.abs(z+2)>=52&&Math.abs(z+2)<=60?'concrete':
   Math.abs(z+2)<16?'concrete':Math.abs(x+2)<20&&Math.abs(z+2)<44?'stone':
   theme==='orbital'?(Math.abs(z+2)>68?'ash':'rock'):(Math.abs(z+2)>68?'grass':'dirt');
  quad([[x,y(x),z],[x,y(x),z+4],[x+4,y(x+4),z+4],[x+4,y(x+4),z]],material);
 }
 for(const d of decks)for(let x=d.x-d.length/2-d.ramp;x<d.x+d.length/2+d.ramp;x+=4){
  for(const side of [-1,1]){
   const z=d.z+side*d.width/2,a=height(d,x),b=height(d,x+4);
   const p=[[x,0,z],[x,a,z],[x+4,b,z],[x+4,0,z]];
   if(a>0)tri(side>0?[p[2],p[1],p[0]]:[p[0],p[1],p[2]],'concrete',false);
   if(b>0)tri(side>0?[p[3],p[2],p[0]]:[p[0],p[2],p[3]],'concrete',false);
  }
 }
 const terrain={surfaces:[...surfaces.values()],walls:[],base:0,amplitude:4,maxSlope:.9,cell:2};
 terrain.height=(x,z)=>floorHeightAtLattice(ensureFloorLattice(terrain),x,z,terrain.maxSlope);
 return terrain;
}

function device(id,kind,laneId,from,to,ground,extra={}){
 const at=([x,z])=>point(x,z,ground(x,z));
 return {id,kind,lane:laneId,from:at(from),...(kind==='launcher'?{target:at(to)}:{to:at(to)}),
  arrival:{...at(to),r:5,seconds:1.5,approaches:2},approaches:2,
  cuttable:true,lockable:true,vehiclesAllowed:false,bypassFraction:.5,cooldown:2.5,...extra};
}

function makeTheatre(spec){
 const orbital=spec.theme==='orbital',frontZ=orbital?-8:12,econX=orbital?8:-8;
 const decks=orbital?[
  deck('meridian-gallery',0,-64,32,8,4,16),deck('night-gallery',0,64,32,8,4,16),
  ...paired([deck('archive-wing',-56,-28,16,8,3,12)]),
 ]:[
  deck('upper-dam',0,-64,64,8,4,16),deck('lower-dam',0,64,64,8,4,16),
  ...paired([deck('filter-wing',-56,32,24,8,3,12)]),
 ];
 const terrain=theatreTerrain(spec.theme,decks),ground=(x,z)=>terrain.height(x,z);
 const nodes=[node('hq-0',-104,0,12,'hq'),node('hq-1',104,0,12,'hq'),
  node('front-0',-52,frontZ,14,'front'),node('front-1',52,-frontZ,14,'front'),
  node('econ-n',econX,-32,14,'economy'),node('econ-s',-econX,32,14,'economy'),node('relay-0',0,0,14,'relay')]
  .map((n,i)=>({...n,y:ground(n.x,n.z),label:spec.labels[i]}));
 const teams=teamSpawns([[-112,0],[-108,-5],[-108,5]],[[112,0],[108,5],[108,-5]]);
 const spawns=[...teams[0],...teams[1],[-76,-40],[76,40],[-32,44],[32,-44]];
 const terminals=[terminal('relay-0-terminal','relay-0','relay',0,0),
  terminal('vault-hq-0','hq-0','vault',-104,0),terminal('vault-hq-1','hq-1','vault',104,0)];
 const road=[[-112,-56],[-80,-56],[-44,-56],[0,-56],[44,-56],[80,-56],[112,-56]];
 const centre=[[-112,0],[-104,0],[-92,0],[-84,frontZ],[-52,frontZ],[-28,frontZ],[-24,0],[0,0],
  [24,0],[28,-frontZ],[52,-frontZ],[84,-frontZ],[92,0],[104,0],[112,0]];
 const flank=[[-112,44],[-84,44],[-40,44],[-28,48],[0,48],[28,48],[40,44],[84,44],[112,44]];
 const lanes=[
  lane('freight-ring','vehicle-road',road,{identity:'vehicle-road',width:10,slopeCap:.3,vehicles:true,
   bypassFraction:.5,chokepoints:2,landmark:orbital?'antenna-meridian':'spillway-gates',variants:[rotate(road)]}),
  lane('facility-spine','cqc',centre,{identity:'cqc',width:6,slopeCap:.3,vehicles:false,
   bypassFraction:.5,chokepoints:2,landmark:orbital?'open-oculus':'turbine-control'}),
  lane('maintenance-flank','zipline-flank',flank,{identity:'zipline-flank',width:8,slopeCap:.3,vehicles:false,
   bypassFraction:.5,chokepoints:1,landmark:orbital?'night-gallery':'root-gallery',variants:[rotate(flank)]}),
 ];
 const traversal=[];
 for(const s of [-1,1]){
  const p=(x,z)=>[x*s,z*s],suffix=s<0?'west':'east';
  traversal.push(device(`freight-launch-${suffix}`,'launcher','freight-ring',p(84,56),p(36,56),ground),
   device(`service-zip-${suffix}`,'zipline','maintenance-flank',p(80,44),p(32,44),ground,{speed:12,lift:2.4,sag:.5}),
   device(`spine-link-${suffix}`,'teleporter','facility-spine',p(76,-frontZ),p(28,-frontZ),ground));
 }
 const depot=(id,x,z,team,hq)=>({id,x,z,y:0,lane:'freight-ring',team,hq,exits:2,vehicle:'puma',
  nodeDistanceMeters:Math.min(...nodes.map(n=>Math.hypot(x-n.x,z-n.z))),chokepointDistanceMeters:20});
 const depots=[depot('hq-depot-west',-104,-56,0,true),depot('hq-depot-east',104,56,1,true),
  depot('forward-depot-west',-64,-56,null,false),depot('forward-depot-east',64,56,null,false)];
 // Vehicles are also authored for combined-arms consumers. COCS modes disable
 // ambient vehicles and purchase a Puma at these same clear, two-exit depots.
 const vehicles=[{kind:'puma',x:-104,y:0,z:-56,team:0,yaw:Math.PI/2},{kind:'puma',x:104,y:0,z:56,team:1,yaw:-Math.PI/2}];
 const pickups=[];
 for(const [kind,x,z] of [['health',-92,-20],['armor',-92,20],['rocket',-72,-44],['rail',0,-64],
  ['scatter',-40,20],['plasma',-76,0],['grenade',-32,-40],['shock',-52,44],['flak',-24,24],
  ['haste',-40,-56],['overcharge',-24,0],['overshield',-8,16],['megahealth',-8,32],
  ['marksman',-80,28],['smg',-104,8],['recon',-96,36],['cloak',-40,44]]){
  pickups.push([kind,x,z],[kind,-x,-z]);
 }
 const blocks=[],structures=[],props=[],navNodes=[],districts=[];
 // Reserve interaction bodies first, including the runtime's node-centred
 // HACK/DEPLOY/SABOTAGE and HQ VAULT sockets. Dressing cannot displace them.
 const reserved=[...nodes.map(n=>({...n,r:5})),...spawns.map(([x,z])=>({x,z,r:2.5})),
  ...depots.map(d=>({...d,r:8})),...pickups.map(([,x,z])=>({x,z,r:1.5})),
  ...traversal.flatMap(d=>[{...d.from,r:2.5},{...d.arrival,r:5}])];
 const overlaps=(x,z,w,d,r)=>Math.abs(x-r.x)<w/2+r.r&&Math.abs(z-r.z)<d/2+r.r;
 const solid=(x,z,w,d,h,kind='wall')=>{
  // Reject, rather than move, dressing which conflicts with a gameplay socket.
  if(reserved.some(r=>overlaps(x,z,w,d,r)))return false;
  const y=ground(x,z);
  blocks.push({x,z,w,d,h:y+h,kind});return true;
 };
 const column=(x,z,height=8,radius=.7)=>{
  if(!solid(x,z,radius*2.7,radius*2.7,height,'column'))return;
  structures.push({type:'column',x,z,y:ground(x,z),height,radius});
 };
 // Roofless facilities have four genuine ground gates, interrupted interior
 // partitions and adjacent filled roof wings. Every rendered wall is a block.
 const hall=(id,x,z,w,d,h=6,kind='building')=>{
  const gap=8,t=.8;
  for(const s of [-1,1])for(const e of [-1,1]){
   solid(x+s*(w+gap)/4,z+e*d/2,(w-gap)/2,t,h,kind);
   solid(x+e*w/2,z+s*(d+gap)/4,t,(d-gap)/2,h,kind);
  }
  for(const s of [-1,1])solid(x+s*(w/2-3),z+s*(d/2-3),3,.8,2.4,'partition');
  structures.push({type:'compound',id,x,z,y:ground(x,z),w,d,h,roof:'open',rooms:[2,2],
   entrances:['north','south','east','west'],doorWidth:gap});
  districts.push({id,x,z,label:spec.districtNames?.[id]??id});
  for(const [dx,dz] of [[0,0],[w/2+3,0],[-w/2-3,0],[0,d/2+3],[0,-d/2-3]])navNodes.push({x:x+dx,z:z+dz});
 };
 hall('command-west',-104,0,24,24,7,'base-hq');hall('command-east',104,0,24,24,7,'base-hq');
 hall('front-west',-52,frontZ,24,20,6.5,'base-bastion');hall('front-east',52,-frontZ,24,20,6.5,'base-bastion');
 hall('economy-north',econX,-32,22,18,5.5);hall('economy-south',-econX,32,22,18,5.5);
 hall('relay-control',0,0,28,24,8);
 // Staggered command approach screens protect the spawn courts while leaving
 // the centre gate and both side exits open to infantry and Director attacks.
 for(const s of [-1,1]){
  solid(-88*s,-6*s,3,7,5,'base-screen');solid(-96*s,18*s,10,2,4,'base-screen');
  hall(`freight-office-${s}`,-84*s,-30*s,16,16,5);
  for(const x of [-112,-96,-72,-56])column(x*s,-66*s,7,.65);
  solid(-84*s,-66*s,8,2,5,'depot-wall');
  // Low off-axis cover divides the fronts without sealing cross-lane doors.
  for(const [x,z,w,d] of [[-36,16,5,2],[-24,-20,2,6],[-80,16,4,2],[-20,44,4,2]])solid(x*s,z*s,w,d,1.8,'cover');
 }

 if(orbital){
  // The broken observatory is an open instrument court, with cardinal access
  // between tall meridian piers and a quieter archive district on each flank.
  for(const [x,z] of [[-12,-10],[12,-10],[-12,10],[12,10]])column(x,z,13,1);
  for(const s of [-1,1]){
   hall(`archive-${s}`,-88*s,40*s,18,16,5.5);
   for(const x of [-20,-12,12,20])column(x,72*s,10+(Math.abs(x)===20?3:0),.6);
   solid(-36*s,68*s,5,3,6,'reactor');
   // Narrow colonnades read as transmitter combs against the night sky.
   for(const x of [48,56,64,72,80])column(x*s,72*s,5+(x%3),.4);
   solid(56*s,68*s,18,1.2,2.2,'relay-feed');
   solid(-12*s,20*s,5,2,3,'reactor');
  }
 }else{
  // Two ramped dam crests overlook an open spillway road. Massive separated
  // gate piers leave the ring road continuous; filter rooms face forest paths.
  for(const s of [-1,1]){
   for(const x of [-36,-20,20,36]){
    solid(x,72*s,7,6,10,'dam-buttress');column(x,72*s,12,1.3);
   }
   hall(`filter-house-${s}`,-88*s,36*s,18,20,6);
   for(const [x,z] of [[-16,-12],[-16,12]])column(x*s,z*s,10,1.4);
    // Keep the reactor two metres outside the filter ramp's z=28 edge;
    // its former z=28 centre sealed the east toe at (-32,32). Mirror both.
    solid(-32*s,22*s,3,8,4,'reactor');solid(-44*s,-36*s,7,3,4,'pump');
   for(const x of [-12,-4,4,12])solid(x,74*s,4,2,2,'sluice');
  }
 }

 // Restrained, explicit dressing coordinates. Keep full prop bounds clear of
 // walls, decks and lane corridors; the prop/collider pair is added atomically.
 const distanceToSegment=(p,a,b)=>{
  const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((p.x-a[0])*dx+(p.z-a[1])*dz)/(dx*dx+dz*dz||1));
  return Math.hypot(p.x-a[0]-t*dx,p.z-a[1]-t*dz);
 };
 const paths=lanes.flatMap(l=>[l.waypoints,...(l.variants??[])]);
 const prop=(type,x,z,scale=1)=>{
  const radius=type==='tree'?1.1*scale:type==='rock'?1.3*scale:type==='crate'?.6*scale:.5*scale;
  if(reserved.some(r=>overlaps(x,z,radius*2,radius*2,r))||
   blocks.some(b=>Math.abs(x-b.x)<b.w/2+radius+1&&Math.abs(z-b.z)<b.d/2+radius+1)||
   decks.some(d=>Math.abs(x-d.x)<d.length/2+d.ramp+radius&&Math.abs(z-d.z)<d.width/2+radius)||
   paths.some(p=>p.slice(1).some((b,i)=>distanceToSegment({x,z},p[i],b)<radius+5)))return;
  const y=ground(x,z),seed=type==='crate'?0:(spec.seed+Math.abs(x*37+z*101))>>>0;
  props.push({type,x,z,y,scale,seed});
  // Full tree crown bounds are collidable too; foliage stays off walk routes.
  const height=type==='tree'?3.3*scale:type==='rock'?1.55*scale:type==='crate'?1.2*scale:1.16*scale;
  // The renderer already hides column proxies. Use that family for cylindrical
  // barrels so their solid does not also draw a rectangular metal box.
  blocks.push({x,z,w:radius*2,d:radius*2,h:y+height,kind:type==='barrel'?'column':type,propType:type});
 };
 for(const s of [-1,1]){
  for(const [x,z,type,scale] of [[-114,-28,'rock',1.5],[-114,28,'rock',1.8],[-72,68,'crate',1.5],
   [-92,70,'barrel',1.2],[-32,32,'crate',1.2],[-72,28,'rock',1.4],[-40,72,'rock',1.8],
   [-100,-38,'barrel',1.2],[-20,-44,'crate',1.1],[-44,4,'crate',1.1]])prop(type,x*s,z*s,scale);
  if(!orbital)for(const [x,z,scale] of [[-112,72,2],[-100,72,2.4],[-84,72,2.2],[-64,72,2.5],
   [-116,40,1.8],[-116,-40,2],[-108,-28,2.3],[-76,22,1.9],[-36,-24,1.7],[-28,72,2.1],
   [-100,24,1.7],[-60,-36,1.8],[-24,36,1.6],[-44,72,2.1]])prop('tree',x*s,z*s,scale);
 }
 // Explicit landing and roof chains augment a modest six-metre navigation grid.
 for(let x=-114;x<120;x+=6)for(let z=-74;z<80;z+=6){
  const y=ground(x,z);
  if(!blocks.some(b=>Math.abs(x-b.x)<b.w/2+.65&&Math.abs(z-b.z)<b.d/2+.65&&b.h>y+.01))navNodes.push({x,z});
 }
 for(const d of decks)for(let x=d.x-d.length/2-d.ramp;x<=d.x+d.length/2+d.ramp;x+=3)navNodes.push({x,z:d.z});
 for(const p of paths)for(let i=1;i<p.length;i++){
  const a=p[i-1],b=p[i],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3);
  for(let j=0;j<=steps;j++)navNodes.push({x:a[0]+(b[0]-a[0])*j/steps,z:a[1]+(b[1]-a[1])*j/steps});
 }
 navNodes.push(...nodes,...depots,...spawns.map(([x,z])=>({x,z})),...pickups.map(([,x,z])=>({x,z})),
  ...traversal.flatMap(d=>[d.from,d.to??d.target]));
 return {
  id:spec.id,name:spec.name,tag:spec.tag,description:spec.description,
  color:spec.color,background:spec.background,floorColor:orbital?'#667589':'#557365',
  biome:orbital?'ruins':'forest',sky:orbital?'night':'day',timeOfDay:false,
  nextGen:true,raised:false,scatter:false,seed:spec.seed,voidY:-16,
   arena:{group:'outdoor',scale:'warzone',play:['cocs','cocs-coop']},collection:'destinations',
  bounds:{...bounds},playBounds:{...bounds,frontage:240,laneSep:56,maxNodeSpacing:80},
  terrain,blocks,structures,props,nodes,lattice:links.map(e=>[...e]),terminals,lanes,traversal,depots,vehicles,
  teamSpawns:teams,flagSpawns:flagSpawns(-112,112),spawns,pickups,
  objectiveZones:nodes.filter(n=>n.archetype!=='hq').map(n=>({...zone(n.x,n.z,6,n.id),y:n.y})),
  navNodes:[...new Map(navNodes.map(n=>[`${n.x.toFixed(3)},${n.z.toFixed(3)}`,n])).values()],
  landmarks:nodes.map(n=>({label:n.label,x:n.x,z:n.z,y:n.y+9})),
  destination:{theme:spec.theme,districts,serviceDecks:decks,terminalClearance:5,arrivalClearance:5,
   liveNodes:{opening:3,max:5,endgame:5},roofAccess:'double-ended ground-supported ramps'},
 };
}

const asterionRelay=makeTheatre({
 id:'asterion-relay',name:'Asterion Relay',theme:'orbital',seed:86121,
 tag:'LATTICE / ORBITAL OBSERVATORY',color:'#91d9ef',background:'#101b32',
 description:'An abandoned orbital communications observatory. Cross the open oculus, breach roofless archive halls, or climb the meridian service galleries above the freight ring. Paired transmitter fields silhouette the long outer flanks.',
 labels:['WEST / FLIGHT CONTROL','EAST / FLIGHT CONTROL','WEST / ARCHIVE GATE','EAST / ARCHIVE GATE',
  'NORTH / SOLAR EXCHANGE','SOUTH / DEEP ARRAY','ASTERION / OCULUS'],
});
const monsoonFoundry=makeTheatre({
 id:'monsoon-foundry',name:'Monsoon Foundry',theme:'forest-dam',seed:86122,
 tag:'OPERATIONS / FOREST DAM',color:'#9cc9a2',background:'#607a75',
 description:'Rainforest roots reclaim a hydro-industrial processing complex. Broad ramped dam crests overlook the spillway freight roads; broken filter houses and turbine courts shelter the inland approaches to the control relay.',
 labels:['WEST / WATERSHED HQ','EAST / WATERSHED HQ','WEST / FILTER COURT','EAST / FILTER COURT',
  'NORTH / INTAKE','SOUTH / PROCESSING','MONSOON / TURBINE CONTROL'],
});

export const DESTINATION_LATTICE_MAPS=freeze([asterionRelay,monsoonFoundry]);
export default DESTINATION_LATTICE_MAPS;
