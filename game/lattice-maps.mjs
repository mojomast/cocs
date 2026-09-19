// Lattice slice maps — the V0a stand-in for a purpose-built LATTICE STRIKE
// theatre (docs/design/COCS-MAP-ARCHITECTURE.md §1, COCS-MODE-SPEC.md §4).
//
// This module is deliberately *non-terrain*: the floor is flat (floorAt is an
// O(1) AABB scan, no heightfield) and the map is flagged `nextGen` so the
// navigation graph is built with the spatial-grid edge pass (O(n)) instead of
// the legacy O(n^2) walkEdge product. That is what keeps a 240 m play band
// inside the `new Match <= 2 s` budget on today's core.mjs, before the M0
// nav bake lands. Blocks only shape cover, lanes and chokepoints; they never
// move the floor.
//
// The layout is rotationally symmetric (x,z) -> (-x,-z), matching the rev-3
// authoritative lattice: one HQ behind each front anchor, a central relay
// flanked by a shared economy siphon to the north and south. Each siphon is
// adjacent to *both* front gates and the relay, so it is a genuine meeting node
// rather than a one-team back-cap: either side can contest it from its own
// gate, which is what forces a second and third simultaneous front. Five
// capturable nodes also stops one won relay fight from arming dominance. The
// full 7+2+2 catalogue lives in a later wave; this slice is the minimal graph
// W1 can drive with authored coordinates.
import {freeze,wall,cover,zone,node,edge,lane,terminal,teamSpawns,flagSpawns} from './map-schema.mjs';

// Rot-180 mirror so every authored block has an opposite twin.
const mirror=block=>({...block,x:-block.x,z:-block.z});
const paired=(...blocks)=>blocks.flatMap(block=>[block,mirror(block)]);

const NORTH=-50,CENTRE=0,SOUTH=50;
// The two shared siphons sit just off the central relay so a single scrum on
// the core can contest more than one node at once (multi-front) and the teams
// meet on the point instead of in transit.
const ECON_N=25,ECON_S=-25;

const latticeSlice={
 id:'lattice-slice',name:'Lattice Slice',tag:'LATTICE STRIKE / V0a SLICE',
 description:'A flat, rotationally symmetric 240 m theatre slice: two HQ compounds, two front gates and a tight central lattice of a relay flanked by a north and a south economy siphon, joined by a north vehicle road, a centre CQC lane and a south flank lane.',
 color:'#7fe3c8',background:'#06141a',
 raised:false,nextGen:true,
 bounds:{minX:-120,maxX:120,minZ:-120,maxZ:120},
 // Frontage is HQ-to-HQ across the contested (x) axis; the band is 240 x 240.
 // Lane separation (50 m) and the gate spacing (54 m) are the authored doctrine
 // values; the shared siphons sit 25 m off the central relay, inside the 54 m
 // gate spacing (declared cap 60 m).
 playBounds:{minX:-120,maxX:120,minZ:-120,maxZ:120,frontage:240,laneSep:50,maxNodeSpacing:60},
 // Seven nodes: 2 HQ anchors + 5 capturable (west gate, north siphon, centre
 // relay, south siphon, east gate). Rot-180 pairs:
 //   hq-0 <-> hq-1, front-0 <-> front-1, econ-n <-> econ-s.
 // econ-n / econ-s each neighbour BOTH gates and the relay, so both teams have
 // a legal approach to every shared node. Capturable radii are 14 m: the
 // control points are large enough that a nearby scrum genuinely counts as
 // fighting *on* the point rather than 11 m off it (the authored doctrine
 // radius for a contested node).
 nodes:[
  node('hq-0',-108,0,12,'hq'),
  node('hq-1',108,0,12,'hq'),
  node('front-0',-54,0,14,'front'),
  node('econ-n',0,ECON_N,14,'economy'),
  node('relay-0',0,0,14,'relay'),
  node('econ-s',0,ECON_S,14,'economy'),
  node('front-1',54,0,14,'front'),
 ],
 lattice:[
  edge('hq-0','front-0'),edge('hq-1','front-1'),
  edge('front-0','relay-0'),edge('relay-0','front-1'),
  edge('front-0','econ-n'),edge('front-1','econ-n'),edge('relay-0','econ-n'),
  edge('front-1','econ-s'),edge('front-0','econ-s'),edge('relay-0','econ-s'),
 ],
 terminals:[terminal('relay-0-terminal','relay-0','relay',0,6)],
 lanes:[
  lane('north-road','vehicle-road',[[-108,NORTH],[-54,NORTH],[0,NORTH],[54,NORTH],[108,NORTH]],{width:8,slopeCap:.3,identity:'vehicle-road',vehicles:true,bypassFraction:.5,chokepoints:2,landmark:'gantry'}),
  lane('centre-cqc','cqc',[[-108,CENTRE],[-54,CENTRE],[0,CENTRE],[54,CENTRE],[108,CENTRE]],{width:6,slopeCap:.2,identity:'cqc',vehicles:false,bypassFraction:.5,chokepoints:2,landmark:'foundry-chimney'}),
  lane('south-flank','zipline-flank',[[-108,SOUTH],[-54,SOUTH],[0,SOUTH],[54,SOUTH],[108,SOUTH]],{width:7,slopeCap:.25,identity:'zipline-flank',vehicles:false,bypassFraction:.5,chokepoints:1,landmark:'relay-spire'}),
 ],
 // §6A.1/§6A.2 traversal devices. Neutral, one-way ziplines on the south flank,
 // a ring-road launcher on the north vehicle lane and CQC teleporters/trampolines
 // down the centre. Every exit carries the §6A.3 arrival contract (r >= 5 m,
 // >= 1.0 s, >= 15 m from every spawn, >= 2 approaches, off every capture radius).
 traversal:[
  // North vehicle road: one launcher bridges the ring road (secondary traversal).
  {id:'lap-n',kind:'launcher',lane:'north-road',from:{x:-30,z:NORTH,y:0},target:{x:-52,z:-42,y:0},
   arrival:{x:-52,z:-42,r:5,seconds:1.5,approaches:2,enemySpawnDistanceMeters:75},
   lockable:true,cuttable:true,vehiclesAllowed:false,bypassFraction:.5},
  // Centre CQC: short source teleporters and two terrace trampolines. No vehicles.
  {id:'tp-c-w',kind:'teleporter',lane:'centre-cqc',from:{x:-36,z:CENTRE,y:0},to:{x:-20,z:CENTRE,y:0},
   arrival:{x:-20,z:CENTRE,r:5,seconds:1.5,approaches:2,enemySpawnDistanceMeters:92},
   cuttable:true,lockable:true,vehiclesAllowed:false,bypassFraction:.5},
  {id:'tp-c-e',kind:'teleporter',lane:'centre-cqc',from:{x:36,z:CENTRE,y:0},to:{x:20,z:CENTRE,y:0},
   arrival:{x:20,z:CENTRE,r:5,seconds:1.5,approaches:2,enemySpawnDistanceMeters:92},
   cuttable:true,lockable:true,vehiclesAllowed:false,bypassFraction:.5},
  {id:'pad-c-n',kind:'jump-pad',lane:'centre-cqc',from:{x:-16,z:16,y:0},power:16,
   arrival:{x:-16,z:22,r:5,seconds:1.2,approaches:2,enemySpawnDistanceMeters:98},
   cuttable:true,lockable:true,vehiclesAllowed:false,bypassFraction:.4},
  {id:'pad-c-s',kind:'jump-pad',lane:'centre-cqc',from:{x:16,z:-16,y:0},power:16,
   arrival:{x:16,z:-22,r:5,seconds:1.2,approaches:2,enemySpawnDistanceMeters:98},
   cuttable:true,lockable:true,vehiclesAllowed:false,bypassFraction:.4},
  // South flank: the fastest rotate, the most cuttable. Four one-way ziplines
  // and two jump pads; no vehicles.
  {id:'zip-s-w',kind:'zipline',lane:'south-flank',from:{x:-40,z:SOUTH,y:0},to:{x:-6,z:44,y:0},
   arrival:{x:-6,z:44,r:5,seconds:1.5,approaches:2,enemySpawnDistanceMeters:113},
   cuttable:true,vehiclesAllowed:false,bypassFraction:.5,speed:9},
  {id:'zip-s-e',kind:'zipline',lane:'south-flank',from:{x:40,z:SOUTH,y:0},to:{x:6,z:44,y:0},
   arrival:{x:6,z:44,r:5,seconds:1.5,approaches:2,enemySpawnDistanceMeters:114},
   cuttable:true,vehiclesAllowed:false,bypassFraction:.5,speed:9},
  {id:'zip-s-w2',kind:'zipline',lane:'south-flank',from:{x:-88,z:SOUTH,y:0},to:{x:-60,z:46,y:0},
   arrival:{x:-60,z:46,r:5,seconds:1.5,approaches:2,enemySpawnDistanceMeters:68},
   cuttable:true,vehiclesAllowed:false,bypassFraction:.5,speed:9},
  {id:'zip-s-e2',kind:'zipline',lane:'south-flank',from:{x:88,z:SOUTH,y:0},to:{x:60,z:46,y:0},
   arrival:{x:60,z:46,r:5,seconds:1.5,approaches:2,enemySpawnDistanceMeters:73},
   cuttable:true,vehiclesAllowed:false,bypassFraction:.5,speed:9},
  {id:'pad-s-w',kind:'jump-pad',lane:'south-flank',from:{x:-26,z:SOUTH,y:0},power:15,
   arrival:{x:-26,z:44,r:5,seconds:1.2,approaches:2,enemySpawnDistanceMeters:95},
   cuttable:true,lockable:true,vehiclesAllowed:false,bypassFraction:.4},
  {id:'pad-s-e',kind:'jump-pad',lane:'south-flank',from:{x:30,z:SOUTH,y:0},power:15,
   arrival:{x:30,z:44,r:5,seconds:1.2,approaches:2,enemySpawnDistanceMeters:95},
   cuttable:true,lockable:true,vehiclesAllowed:false,bypassFraction:.4},
 ],
 // §6A.1/§6A.7 depots: one never-capturable HQ depot per team plus two neutral
 // forward depots, all on the north vehicle road. Sited >=30 m from a node
 // capture centre and >=12 m from a chokepoint, with the owner-only 6 m apron.
 depots:[
  {id:'depot-hq-w',lane:'north-road',team:0,hq:true,x:-100,z:NORTH,y:0,exits:2,nodeDistanceMeters:51,chokepointDistanceMeters:22,vehicle:'puma'},
  {id:'depot-hq-e',lane:'north-road',team:1,hq:true,x:100,z:NORTH,y:0,exits:2,nodeDistanceMeters:51,chokepointDistanceMeters:22,vehicle:'puma'},
  {id:'depot-fwd-w',lane:'north-road',team:null,x:-70,z:NORTH,y:0,exits:2,nodeDistanceMeters:53,chokepointDistanceMeters:20,vehicle:'puma'},
  {id:'depot-fwd-e',lane:'north-road',team:null,x:70,z:NORTH,y:0,exits:2,nodeDistanceMeters:53,chokepointDistanceMeters:20,vehicle:'puma'},
 ],
 teamSpawns:teamSpawns([[-116,0],[-112,-4],[-112,4]],[[116,0],[112,4],[112,-4]]),
 flagSpawns:flagSpawns(-116,116),
 spawns:[[-116,0],[116,0],[-108,-12],[108,12],[-54,-24],[54,24],[0,-30],[0,30],[-30,-50],[30,50]],
 blocks:[
  // HQ compounds: a rear gap (west/east) plus an open front toward the lane.
  ...paired(
   wall(-116,-8,2,12,5,'hq-wall'),wall(-116,8,2,12,5,'hq-wall'),
   wall(-112,-16,12,2,5,'hq-wall'),wall(-112,16,12,2,5,'hq-wall'),
   cover(-104,-10,4,3,2.5),cover(-104,10,4,3,2.5),
  ),
  // FRONT gates straddle the centre lane; flanking overlooks cover the gate.
  ...paired(
   wall(-54,-10,4,8,4,'fort'),wall(-54,10,4,8,4,'fort'),
   cover(-62,-20,3,3,2.4),cover(-62,20,3,3,2.4),cover(-54,20,3,3,2.4),
  ),
  // Central relay foundry: north/south gates and four corner covers.
  wall(0,-14,16,3,4,'foundry'),wall(0,14,16,3,4,'foundry'),
  ...paired(cover(-11,-7,3,3,3.2,'foundry-cover'),cover(-11,7,3,3,3.2,'foundry-cover')),
  // Lane cover chains (north/south separated by laneSep, centre on CENTRE).
  ...paired(
   cover(-90,-50,4,2,2),cover(-70,-50,4,2,2),cover(-34,-50,4,2,2),
   cover(90,-50,4,2,2),cover(70,-50,4,2,2),cover(34,-50,4,2,2),
   cover(-80,0,4,2,2),cover(80,0,4,2,2),
   cover(-90,50,4,2,2),cover(-70,50,4,2,2),cover(-34,50,4,2,2),
   cover(90,50,4,2,2),cover(70,50,4,2,2),cover(34,50,4,2,2),
  ),
 ],
 pickups:[
  ['health',-88,-44],['health',88,44],['armor',-88,44],['armor',88,-44],
  ['rocket',-80,-56],['rocket',80,56],['rail',-30,-44],['rail',30,44],
  ['scatter',-30,44],['scatter',30,-44],['plasma',-88,0],['plasma',88,0],
  ['grenade',-54,-30],['grenade',54,30],['shock',-54,30],['shock',54,-30],
  ['flak',0,-40],['flak',0,40],['haste',-20,-50],['haste',20,50],
  ['overcharge',20,-50],['overcharge',-20,50],['overshield',0,10],['megahealth',0,-10],
  ['marksman',-116,-20],['smg',116,20],
 ],
 objectiveZones:[zone(-54,0,6,'front-west'),zone(0,0,6,'relay'),zone(54,0,6,'front-east')],
 navNodes:[
  {x:-108,z:0},{x:-81,z:0},{x:-54,z:0},{x:-27,z:0},{x:0,z:0},{x:27,z:0},{x:54,z:0},{x:81,z:0},{x:108,z:0},
  {x:0,z:ECON_N},{x:0,z:ECON_S},
  {x:-108,z:NORTH},{x:-54,z:NORTH},{x:0,z:NORTH},{x:54,z:NORTH},{x:108,z:NORTH},
  {x:-108,z:SOUTH},{x:-54,z:SOUTH},{x:0,z:SOUTH},{x:54,z:SOUTH},{x:108,z:SOUTH},
  {x:-54,z:-30},{x:54,z:30},{x:-54,z:30},{x:54,z:-30},
 ],
 landmarks:[
  {label:'WEST HQ',x:-108,z:0,y:6},
  {label:'WEST FRONT',x:-54,z:0,y:5},
  {label:'NORTH SIPHON',x:0,z:ECON_N,y:5},
  {label:'FOUNDRY RELAY',x:0,z:0,y:7},
  {label:'SOUTH SIPHON',x:0,z:ECON_S,y:5},
  {label:'EAST FRONT',x:54,z:0,y:5},
  {label:'EAST HQ',x:108,z:0,y:6},
 ],
};

export const LATTICE_MAPS=freeze([latticeSlice]);
export default LATTICE_MAPS;
