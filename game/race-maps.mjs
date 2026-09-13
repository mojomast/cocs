const centerline=[[0,-48],[50,-48],[80,-28],[88,0],[80,28],[50,48],[0,48],[-50,48],[-80,28],[-88,0],[-80,-28],[-50,-48]].map(([x,z])=>({x,z}));
const segmentLengths=centerline.map((p,i)=>{const q=centerline[(i+1)%centerline.length];return Math.hypot(q.x-p.x,q.z-p.z);});
const lapLength=segmentLengths.reduce((sum,length)=>sum+length,0);
// Furniture is authored on the racing line: trackPoint walks a segment and
// shifts laterally by lane so pads/coins reward a clean line without leaving
// the road. lapPoint addresses the whole 12-checkpoint loop by arc distance.
const trackPoint=(index,t,lane=0)=>{const a=centerline[index],b=centerline[(index+1)%centerline.length],length=segmentLengths[index],dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;return{x:a.x+(b.x-a.x)*t-dz*lane,z:a.z+(b.z-a.z)*t+dx*lane};};
const lapPoint=(distance,lane=0)=>{let s=((distance%lapLength)+lapLength)%lapLength,index=0;while(s>segmentLengths[index]){s-=segmentLengths[index];index++;}return trackPoint(index,s/segmentLengths[index],lane);};
const tangents=centerline.map((p,i)=>{
 const q=centerline[(i+1)%centerline.length],length=Math.hypot(q.x-p.x,q.z-p.z);
 return {x:(q.x-p.x)/length,z:(q.z-p.z)/length};
});
const gates=centerline.map((p,i)=>{
 const a=tangents[(i+tangents.length-1)%tangents.length],b=tangents[i],length=Math.hypot(a.x+b.x,a.z+b.z);
 return {...p,nx:(a.x+b.x)/length,nz:(a.z+b.z)/length,halfWidth:12};
});
const grid=Array.from({length:8},(_,id)=>({x:-8-6*Math.floor(id/2),z:-48+(id%2?3:-3),heading:Math.PI/2}));
// Ten item boxes, evenly phased around the twelve checkpoint segments.
const itemBoxes=Array.from({length:10},(_,id)=>({id:`race-box-${id}`,...lapPoint((id+.5)*lapLength/10)}));
// Boost pads sit on straights and on the exits of the long sweeps, kept clear
// of each other and of the item boxes so a clean line is actually rewarded.
const boostPads=[[0,.18],[0,.72],[1,.8],[2,.5],[3,.55],[5,.22],[5,.78],[6,.2],[9,.5],[11,.3]]
 .map(([index,t],id)=>({id:`race-boost-${id}`,...trackPoint(index,t)}));
// Coins form short rows on the straights and curved spreads through the four
// long corners; lane offsets tuck them toward the apex of the bend.
const coinSpecs=[
 [0,.42,4],[0,.47,4],[0,.52,4],[5,.42,4],[5,.47,4],[5,.52,4],
 [6,.42,4],[6,.47,4],[6,.52,4],[11,.42,4],[11,.47,4],[11,.52,4],
 [1,.35,-4],[1,.75,-4],[2,.35,-4],[3,.35,-4],[3,.75,-4],[4,.35,-4],
 [7,.35,4],[7,.75,4],[8,.35,4],[9,.35,4],[9,.75,4],[10,.35,4],
];
const coins=coinSpecs.map(([index,t,lane],id)=>({id:`race-coin-${id}`,...trackPoint(index,t,lane)}));
const blocks=[],navNodes=[];
const bounds={minX:-104,maxX:104,minZ:-64,maxZ:64};
// Mitered offsets keep a constant-width road through the bends, without wedges.
const boundaries=[-13,13].map(offset=>gates.map((p,i)=>{
 const tangent=tangents[i],scale=offset/(p.nx*tangent.x+p.nz*tangent.z);
 return {x:p.x-p.nz*scale,z:p.z+p.nx*scale};
}));
// Exported for the renderer: the two mitered offset loops. They stay unmerged so
// tools get the authored 12-gate outline; rails merge them per straight edge below.
const boundary={outer:boundaries[0].map(p=>({x:p.x,z:p.z})),inner:boundaries[1].map(p=>({x:p.x,z:p.z}))};
const mergeCollinear=polygon=>{
 const merged=[];
 for(let i=0;i<polygon.length;i++){
  const a=polygon[(i+polygon.length-1)%polygon.length],b=polygon[i],c=polygon[(i+1)%polygon.length];
  const cross=(b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x),span=Math.hypot(c.x-a.x,c.z-a.z)||1;
  if(Math.abs(cross)/span>1e-9)merged.push(b);
 }
 return merged;
};
// Collision rails run per merged straight EDGE. Boxes are 2x2 and spaced 2.0 so
// adjacent faces abut instead of stacking coplanar 2-wide geometry (which z-fights).
const RAIL_SPACING=2,RAIL_HALF=1;
for(const [side,polygon] of boundaries.entries()){
 const merged=mergeCollinear(polygon),label=side===0?'outer':'inner';
 for(let i=0;i<merged.length;i++){
  const a=merged[i],b=merged[(i+1)%merged.length],length=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(length/RAIL_SPACING));
  for(let j=0;j<steps;j++){const t=j/steps;blocks.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,w:2,d:2,h:2.6,kind:'race-rail',side:label});}
 }
}
// Fill both non-driving regions with solid strips. Strips stop one rail half-width
// short of the boundary so the guaranteed perimeter abuts the rails rather than
// stacking a second coplanar face against them.
for(let z=bounds.minZ;z<bounds.maxZ;z++){
 const spans=boundaries.map(polygon=>{
  const xs=[];
  for(let i=0;i<polygon.length;i++){
   const a=polygon[i],b=polygon[(i+1)%polygon.length];
   if(a.z>=z&&a.z<=z+1)xs.push(a.x);
   for(const edgeZ of [z,z+1])if(a.z!==b.z&&edgeZ>=Math.min(a.z,b.z)&&edgeZ<=Math.max(a.z,b.z))xs.push(a.x+(b.x-a.x)*(edgeZ-a.z)/(b.z-a.z));
  }
  return xs.length?[Math.min(...xs),Math.max(...xs)]:null;
 });
 const add=(left,right,kind)=>{if(right>left)blocks.push({x:(left+right)/2,z:z+.5,w:right-left,d:1,h:3,kind});};
 const outer=spans[0],inner=spans[1];
 if(outer){add(bounds.minX,outer[0]-RAIL_HALF,'race-apron');add(outer[1]+RAIL_HALF,bounds.maxX,'race-apron');}
 else add(bounds.minX,bounds.maxX,'race-apron');
 if(inner)add(inner[0]+RAIL_HALF,inner[1]-RAIL_HALF,'race-infield');
}
for(let i=0;i<centerline.length;i++){
 const a=centerline[i],b=centerline[(i+1)%centerline.length],steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3);
 for(let j=0;j<steps;j++)navNodes.push({x:a.x+(b.x-a.x)*j/steps,z:a.z+(b.z-a.z)*j/steps});
}
navNodes.push(...grid.map(({x,z})=>({x,z})),...itemBoxes.map(({x,z})=>({x,z})));

for(const polygon of [boundary.outer,boundary.inner]){polygon.forEach(Object.freeze);Object.freeze(polygon);}
Object.freeze(boundary);
for(const furniture of [itemBoxes,boostPads,coins])furniture.forEach(Object.freeze);
Object.freeze(itemBoxes);Object.freeze(boostPads);Object.freeze(coins);
const race={centerline,gates,grid,itemBoxes,boostPads,coins,boundary};
export const PUMA_CIRCUIT={
 id:'puma-circuit',name:'Puma Circuit',tag:'RACING / PUMA',description:'Eight Pumas, a sweeping charcoal circuit, and a checkered sprint to the finish.',
 color:'#ffba59',background:'#10151c',floorColor:'#292d34',raised:false,bounds,
 blocks,spawns:grid.map(({x,z})=>[x,z]),pickups:[],navNodes,
 vehicles:grid.map(({x,z,heading},id)=>({id,kind:'puma',x,y:0,z,yaw:heading})),
 race,
};
export const RACE_MAPS=[PUMA_CIRCUIT];
