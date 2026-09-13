const centerline=[[0,-48],[50,-48],[80,-28],[88,0],[80,28],[50,48],[0,48],[-50,48],[-80,28],[-88,0],[-80,-28],[-50,-48]].map(([x,z])=>({x,z}));
const tangents=centerline.map((p,i)=>{
 const q=centerline[(i+1)%centerline.length],length=Math.hypot(q.x-p.x,q.z-p.z);
 return {x:(q.x-p.x)/length,z:(q.z-p.z)/length};
});
const gates=centerline.map((p,i)=>{
 const a=tangents[(i+tangents.length-1)%tangents.length],b=tangents[i],length=Math.hypot(a.x+b.x,a.z+b.z);
 return {...p,nx:(a.x+b.x)/length,nz:(a.z+b.z)/length,halfWidth:12};
});
const grid=Array.from({length:8},(_,id)=>({x:-8-6*Math.floor(id/2),z:-48+(id%2?3:-3),heading:Math.PI/2}));
const itemBoxes=[1,3,5,7,9,11].map((index,id)=>({id:`race-box-${id}`,...centerline[index]}));
const blocks=[],navNodes=[];
const bounds={minX:-104,maxX:104,minZ:-64,maxZ:64};
// Mitered offsets keep a constant-width road through the bends, without wedges.
const boundaries=[-13,13].map(offset=>gates.map((p,i)=>{
 const tangent=tangents[i],scale=offset/(p.nx*tangent.x+p.nz*tangent.z);
 return {x:p.x-p.nz*scale,z:p.z+p.nx*scale};
}));
for(const [side,polygon] of boundaries.entries())for(let i=0;i<polygon.length;i++){
 const a=polygon[i],b=polygon[(i+1)%polygon.length],steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/1.5);
 for(let j=0;j<steps;j++)blocks.push({x:a.x+(b.x-a.x)*j/steps,z:a.z+(b.z-a.z)*j/steps,w:2,d:2,h:2.6,kind:'race-rail',side:side===0?'outer':'inner'});
}
// Fill both non-driving regions with solid strips. Rails cover the conservative
// strip edges; unlike a bounding-box infield these cannot cut across a corner.
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
 if(outer){add(bounds.minX,outer[0],'race-apron');add(outer[1],bounds.maxX,'race-apron');}
 else add(bounds.minX,bounds.maxX,'race-apron');
 if(inner)add(inner[0]+1,inner[1]-1,'race-infield');
}
for(let i=0;i<centerline.length;i++){
 const a=centerline[i],b=centerline[(i+1)%centerline.length],steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3);
 for(let j=0;j<steps;j++)navNodes.push({x:a.x+(b.x-a.x)*j/steps,z:a.z+(b.z-a.z)*j/steps});
}
navNodes.push(...grid.map(({x,z})=>({x,z})),...itemBoxes.map(({x,z})=>({x,z})));

export const PUMA_CIRCUIT={
 id:'puma-circuit',name:'Puma Circuit',tag:'RACING / PUMA',description:'Eight Pumas, a sweeping charcoal circuit, and a checkered sprint to the finish.',
 color:'#ffba59',background:'#10151c',floorColor:'#292d34',raised:false,bounds,
 blocks,spawns:grid.map(({x,z})=>[x,z]),pickups:[],navNodes,
 vehicles:grid.map(({x,z,heading},id)=>({id,kind:'puma',x,y:0,z,yaw:heading})),
 race:{centerline,gates,grid,itemBoxes},
};
export const RACE_MAPS=[PUMA_CIRCUIT];
