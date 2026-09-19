// Lattice Foundry keeps the queue's stable map id and seven-node strategic graph.
// Everything affecting movement is authored in lattice-foundry.mjs; presentation
// only adds flush cladding, paint and machinery inside those collision volumes.
import {freeze,node,edge,lane,terminal,teamSpawns,flagSpawns,zone} from './map-schema.mjs';
import {foundryGeometry} from './lattice-foundry.mjs';

const geometry=foundryGeometry();
const ground=(x,z)=>geometry.terrain.height(x,z);
const point=(x,z)=>({x,z,y:ground(x,z)});
const arrival=(x,z)=>({...point(x,z),r:5,seconds:1.5,approaches:2});
const device=(id,kind,laneId,from,to,extra={})=>({id,kind,lane:laneId,from:point(...from),
 ...(kind==='launcher'?{target:point(...to)}:kind==='jump-pad'?{}:{to:point(...to)}),
 arrival:arrival(...to),cuttable:true,lockable:true,vehiclesAllowed:false,bypassFraction:.5,cooldown:2.5,...extra});
const devices=[
 device('lap-n','launcher','north-road',[-30,-50],[-52,-42]),
 device('lap-s','launcher','north-road',[30,50],[52,42]),
 device('tp-c-w','teleporter','centre-cqc',[-36,0],[-22,0]),
 device('tp-c-e','teleporter','centre-cqc',[36,0],[22,0]),
 device('pad-c-n','jump-pad','centre-cqc',[-54,-24],[-54,-26],{power:16}),
 device('pad-c-s','jump-pad','centre-cqc',[54,24],[54,26],{power:16}),
 device('zip-s-w','zipline','south-flank',[-40,50],[-6,46],{speed:12,lift:2.2,sag:.55}),
 device('zip-s-e','zipline','south-flank',[40,-50],[6,-46],{speed:12,lift:2.2,sag:.55}),
 device('zip-s-w2','zipline','south-flank',[-88,50],[-60,46],{speed:12,lift:2.2,sag:.55}),
 device('zip-s-e2','zipline','south-flank',[88,-50],[60,-46],{speed:12,lift:2.2,sag:.55}),
 device('pad-s-w','jump-pad','south-flank',[-50,54],[-50,56],{power:15}),
 device('pad-s-e','jump-pad','south-flank',[50,-54],[50,-56],{power:15}),
];
const depot=(id,x,z,team,hq=false)=>({id,lane:'north-road',team,hq,...point(x,z),exits:2,
 nodeDistanceMeters:50,chokepointDistanceMeters:20,vehicle:'puma'});
const pairedPickups=(kind,x,z)=>[[kind,x,z],[kind,-x,-z]];
const rotateRoute=route=>route.map(([x,z])=>[-x,-z]);
const road=[[-108,-50],[-32,-50],[-24,-58],[-8,-58],[0,-50],[30,-50],[34,-40],[54,-40],[60,-50],[108,-50]];
const cqc=[[-108,0],[-108,-7],[-94,-7],[-90,8],[-72,8],[-72,0],[-54,0],[-38,0],[-38,6],[-22,6],[-22,0],[0,0],
 [22,0],[22,-6],[38,-6],[38,0],[54,0],[72,0],[72,-8],[90,-8],[94,7],[108,7],[108,0]];
const flank=[[-108,36],[-84,38],[-54,38],[-38,40],[0,40],[38,40],[54,38],[84,38],[108,36]];
const nodes=[node('hq-0',-108,0,12,'hq'),node('hq-1',108,0,12,'hq'),
 node('front-0',-54,0,14,'front'),node('econ-n',0,-25,14,'economy'),
 node('relay-0',0,0,14,'relay'),node('econ-s',0,25,14,'economy'),node('front-1',54,0,14,'front')]
 .map(n=>({...n,y:ground(n.x,n.z),label:({'hq-0':'West Command','hq-1':'East Command',
  'front-0':'West Bastion','front-1':'East Bastion','econ-n':'North Siphon','econ-s':'South Siphon','relay-0':'Foundry Relay'})[n.id]}));
const spawns=[[-116,0],[116,0],[-108,-6],[108,6],[-54,-24],[54,24],[-18,-30],[18,30],[-30,-50],[30,50]];
const pickups=[...pairedPickups('health',-88,-44),...pairedPickups('armor',-88,44),
 ...pairedPickups('rocket',-80,-56),...pairedPickups('rail',-54,-16),
 ...pairedPickups('scatter',-28,38),...pairedPickups('plasma',-88,0),
 ...pairedPickups('grenade',-54,-30),...pairedPickups('shock',-54,30),
 ...pairedPickups('flak',0,-40),...pairedPickups('haste',-20,-50),
 ...pairedPickups('overcharge',20,-50),...pairedPickups('overshield',-10,0),
 ...pairedPickups('megahealth',0,-25),...pairedPickups('marksman',-106,-18),
 ...pairedPickups('smg',-108,10),...pairedPickups('armor',-86,-28)];

const latticeFoundry={
 id:'lattice-slice',name:'Lattice Foundry',tag:'LATTICE STRIKE / INDUSTRIAL THEATRE',
 description:'Twin bastions guard a copper-and-concrete foundry. Fight through shielded courtyards, descend into the siphon plants, or climb double-ended roof ramps to turn the front. Depots and cuttable transit connect the outer freight loop.',
 color:'#72e0d0',background:'#789098',floorColor:'#718388',biome:'urban',sky:'day',timeOfDay:false,
 nextGen:true,raised:false,scatter:false,seed:7619,
 bounds:{minX:-120,maxX:120,minZ:-72,maxZ:72},
 playBounds:{minX:-120,maxX:120,minZ:-72,maxZ:72,frontage:240,laneSep:50,maxNodeSpacing:60},
 ...geometry,nodes,
 lattice:[edge('hq-0','front-0'),edge('hq-1','front-1'),edge('front-0','relay-0'),edge('relay-0','front-1'),
  edge('front-0','econ-n'),edge('front-1','econ-n'),edge('relay-0','econ-n'),
  edge('front-1','econ-s'),edge('front-0','econ-s'),edge('relay-0','econ-s')],
 terminals:[terminal('relay-0-terminal','relay-0','relay',0,0,ground(0,0))],
 // The freight road is a rotational ring: north outbound, south return. Both
 // teams receive identical depot and device access rather than north-only perks.
 lanes:[
  lane('north-road','vehicle-road',road,
   {width:8,slopeCap:.3,identity:'vehicle-road',vehicles:true,bypassFraction:.5,chokepoints:2,landmark:'freight-gantries',
    variants:[rotateRoute(road)]}),
  lane('centre-cqc','cqc',cqc,
   {width:6,slopeCap:.3,identity:'cqc',vehicles:false,bypassFraction:.5,chokepoints:2,landmark:'relay-chimneys',
    variants:[rotateRoute(cqc)]}),
  lane('south-flank','zipline-flank',flank,
   {width:7,slopeCap:.3,identity:'zipline-flank',vehicles:false,bypassFraction:.5,chokepoints:1,landmark:'siphon-spires',
    variants:[rotateRoute(flank)]}),
 ],
 traversal:devices,
 depots:[depot('depot-hq-w',-100,-50,0,true),depot('depot-hq-e',100,50,1,true),
  depot('depot-fwd-w',-70,-50,null),depot('depot-fwd-e',70,50,null)],
 teamSpawns:teamSpawns([[-116,0],[-112,-4],[-112,4]],[[116,0],[112,4],[112,-4]]),
 flagSpawns:flagSpawns(-116,116),spawns,pickups,
 objectiveZones:[zone(-54,0,6,'front-west'),zone(0,0,6,'relay'),zone(54,0,6,'front-east')].map(z=>({...z,y:ground(z.x,z.z)})),
 navNodes:[...geometry.navNodes,...nodes,...devices.flatMap(d=>[d.from,d.to??d.target??d.arrival]),
  ...spawns.map(([x,z])=>({x,z})),...pickups.map(([,x,z])=>({x,z}))],
 landmarks:nodes.map(n=>({label:({'hq-0':'WEST / HQ','hq-1':'EAST / HQ','front-0':'01 / BASTION','front-1':'02 / BASTION',
  'econ-n':'NORTH / SIPHON','econ-s':'SOUTH / SIPHON','relay-0':'FOUNDRY / RELAY'})[n.id],x:n.x,z:n.z,y:n.y+8})),
};
export const LATTICE_MAPS=freeze([latticeFoundry]);
export default LATTICE_MAPS;
