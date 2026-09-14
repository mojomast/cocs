import {PUMA_CIRCUIT} from './race-maps.mjs';
import {freeze} from './map-schema.mjs';

const team0=[[-24,-6],[-24,6]];
const team1=[[24,-6],[24,6]];
const grid=[
 ...team0.map(([x,z])=>({x,z,heading:Math.PI/2})),
 ...team1.map(([x,z])=>({x,z,heading:-Math.PI/2})),
];

const pitch={minX:-30,maxX:30,minZ:-18,maxZ:18};
const goals=[
 {team:0,x:-30,z:0,nx:-1,nz:0,halfWidth:6,height:4,depth:2},
 {team:1,x:30,z:0,nx:1,nz:0,halfWidth:6,height:4,depth:2},
];
const centerline=[{x:pitch.minX,z:pitch.minZ},{x:pitch.maxX,z:pitch.minZ},{x:pitch.maxX,z:pitch.maxZ},{x:pitch.minX,z:pitch.maxZ}];

const goalBlocks=[];
for(const side of [-1,1]){
 const x=side*30;
 goalBlocks.push({x,z:-6,w:1,d:1,h:4,kind:'soccer-goal'});
 goalBlocks.push({x,z:6,w:1,d:1,h:4,kind:'soccer-goal'});
 goalBlocks.push({x:x+side*2,z:0,w:1,d:12,h:4,kind:'soccer-goal'});
}
// Boards ring the pitch so the ball (and the cars) cannot wander onto the
// circuit. The goals leave a mouth on each goal line; the back walls above
// close the net behind it.
const wallH=3,wallT=1,wallBlocks=[];
for(const z of [-19,19]) wallBlocks.push({x:0,z,w:62,d:wallT,h:wallH,kind:'soccer-wall'});
for(const x of [-31,31]) for(const [z0,z1] of [[-19,-6],[6,19]]) wallBlocks.push({x,z:(z0+z1)/2,w:wallT,d:z1-z0,h:wallH,kind:'soccer-wall'});

const blocks=[...PUMA_CIRCUIT.blocks.filter(b=>b.kind==='race-rail'||b.kind==='race-apron').map(b=>({...b})),...wallBlocks,...goalBlocks];
const spawns=[...team0,...team1];
// A drivable pitch needs no infantry pathing, but the registry validator builds
// the navigation graph; a 4m lattice keeps it connected for tooling.
const navNodes=[];
for(let x=-24;x<=24;x+=4)for(let z=-12;z<=12;z+=4)navNodes.push({x,z});
const race={
 kind:'soccer',pitch,goals,
 ball:{x:0,y:1.1,z:0,r:1.1},
 centerline,gates:[],grid,
 boundary:PUMA_CIRCUIT.race.boundary,
};

export const PUMA_PITCH=freeze({
 id:'puma-pitch',name:'Puma Pitch',
 tag:'SOCCER / PUMA',
 description:'Eight Pumas, a pitch built into the circuit infield, and one ball to smash into the goal.',
 color:PUMA_CIRCUIT.color,background:PUMA_CIRCUIT.background,floorColor:PUMA_CIRCUIT.floorColor,
 raised:false,bounds:PUMA_CIRCUIT.bounds,
 blocks,spawns,teamSpawns:{0:team0.map(s=>[...s]),1:team1.map(s=>[...s])},
 pickups:[],navNodes,
 vehicles:grid.map(({x,z,heading},id)=>({id,kind:'puma',x,y:0,z,yaw:heading})),
 race,
 boundary:PUMA_CIRCUIT.race.boundary,
});

export const SOCCER_MAPS=[PUMA_PITCH];
