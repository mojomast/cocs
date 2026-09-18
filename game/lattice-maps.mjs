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
  lane('north-road','vehicle-road',[[-108,NORTH],[-54,NORTH],[0,NORTH],[54,NORTH],[108,NORTH]],{width:8,slopeCap:.3}),
  lane('centre-cqc','cqc',[[-108,CENTRE],[-54,CENTRE],[0,CENTRE],[54,CENTRE],[108,CENTRE]],{width:6,slopeCap:.2}),
  lane('south-flank','zipline-flank',[[-108,SOUTH],[-54,SOUTH],[0,SOUTH],[54,SOUTH],[108,SOUTH]],{width:7,slopeCap:.25}),
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
