import {freeze} from './map-schema.mjs';
import {facadeFrame} from './structures.mjs';

// Authored sports destinations. All solids are ordinary ground-up AABBs;
// roofs, arches, lamps and instanced props use the existing next-gen art kit.
const point=([x,z])=>({x,z});
const solid=(x,z,w,d,h,kind)=>({x,z,w,d,h,kind});
const vehicles=grid=>grid.map(({x,z,heading},id)=>({id,kind:'puma',x,y:0,z,yaw:heading}));

function building(blocks,structures,x,z,w,d,h,{base=0,roof='flat',kind='building',windows=[]}={}){
 const parent={type:'building',x,y:base,z,w,d,h,rot:0,roof};
 blocks.push(solid(x,z,w,d,base+h,kind));
 structures.push(parent);
 for(const side of windows)structures.push({type:'windows',frame:facadeFrame(parent,side),rows:Math.max(1,Math.floor(h/3.5))});
}

function lightMast(blocks,structures,x,z,height,side,base=0){
 blocks.push(solid(x,z,1.4,1.4,base+height,'light-mast'));
 // The roof is a supported lamp crossbar; emissive facade windows are lamps,
 // not additional dynamic lights, so stadium dressing keeps a fixed light cost.
 const head={type:'building',x,y:base+height-1,z,w:8,d:2,h:1,rot:0,roof:'flat'};
 structures.push(head,{type:'windows',frame:facadeFrame(head,side),rows:1,detail:{width:1.2,height:.8,sill:.1,roof:.1,gap:.5}});
}

function mergeCollinear(points){
 return points.filter((b,i)=>{
  const a=points[(i+points.length-1)%points.length],c=points[(i+1)%points.length];
  return Math.abs((b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x))>1e-7;
 });
}

// A straight axis-aligned rail is ONE block. Diagonals use short, overlapping
// rectangular runs (not a necklace of cubes); every point on the edge is solid.
// At most 2 m of minor-axis travel per run limits the staircase intrusion.
function rails(blocks,polygon,side){
 const loop=mergeCollinear(polygon);
 for(let i=0;i<loop.length;i++){
  const a=loop[i],b=loop[(i+1)%loop.length],dx=b.x-a.x,dz=b.z-a.z;
  const steps=Math.max(1,Math.ceil(Math.min(Math.abs(dx),Math.abs(dz))/2));
  for(let j=0;j<steps;j++)blocks.push({...solid(a.x+dx*(j+.5)/steps,a.z+dz*(j+.5)/steps,Math.abs(dx)/steps+1.2,Math.abs(dz)/steps+1.2,3,'race-rail'),side});
 }
}

// Back the sealed rails with solid infield/apron, including the return-straight
// recess. Split at every polygon vertex, then scan bands no deeper than 3 m.
// Endpoint extrema keep fill entirely off the road, behind the rail face; the
// continuous rail loop seals the small slivers at the stepped fill edge.
// Paired crossings preserve concave outlines and disjoint spans, unlike a
// min/max-only fill. Adjacent identical spans coalesce into one block.
function fillNonDriving(blocks,polygon,bounds,inside,kind){
 const levels=[...new Set([bounds.minZ,bounds.maxZ,...polygon.map(p=>p.z)])].sort((a,b)=>a-b);
 let previous=new Map();
 for(let i=0;i<levels.length-1;i++){
  const steps=Math.max(1,Math.ceil((levels[i+1]-levels[i])/3));
  for(let j=0;j<steps;j++){
   const z0=levels[i]+(levels[i+1]-levels[i])*j/steps,z1=levels[i]+(levels[i+1]-levels[i])*(j+1)/steps,mid=(z0+z1)/2;
   const cuts=[];
   for(let k=0;k<polygon.length;k++){
    const a=polygon[k],b=polygon[(k+1)%polygon.length];
    if(!((a.z<=mid&&b.z>mid)||(b.z<=mid&&a.z>mid)))continue;
    const at=z=>a.x+(b.x-a.x)*(z-a.z)/(b.z-a.z),x0=at(z0),x1=at(z1);
    cuts.push({mid:at(mid),min:Math.min(x0,x1),max:Math.max(x0,x1)});
   }
   cuts.sort((a,b)=>a.mid-b.mid);
   const spans=[];
   if(inside){for(let k=0;k<cuts.length;k+=2)spans.push([cuts[k].max+.6,cuts[k+1].min-.6]);}
   else{
    let left=bounds.minX;
    for(let k=0;k<cuts.length;k+=2){spans.push([left,cuts[k].min-.6]);left=cuts[k+1].max+.6;}
    spans.push([left,bounds.maxX]);
   }
   const current=new Map();
   for(const [left,right] of spans){
    if(right-left<1e-7)continue;
    const key=`${left.toFixed(7)}:${right.toFixed(7)}`,prior=previous.get(key);
    if(prior&&Math.abs(prior.z+prior.d/2-z0)<1e-7){const bottom=prior.z-prior.d/2;prior.z=(bottom+z1)/2;prior.d=z1-bottom;current.set(key,prior);}
    else{const block=solid((left+right)/2,mid,right-left,z1-z0,3,kind);blocks.push(block);current.set(key,block);}
   }
   previous=current;
  }
 }
}

function ionSpeedway(){
 // Clockwise in world XZ: a long launch straight, the east dogleg, a broad
 // summit sweep, then a recessed return straight and the western carousel.
 // The two reverse-curvature sections make this a road course, not an oval.
 const centerline=[[-36,-68],[38,-68],[66,-48],[66,-12],[94,12],[108,42],[100,66],[72,82],[30,82],[2,58],[-38,58],[-76,78],[-106,62],[-120,30],[-120,-24],[-96,-54],[-68,-68]].map(point);
 const lengths=centerline.map((a,i)=>{const b=centerline[(i+1)%centerline.length];return Math.hypot(b.x-a.x,b.z-a.z);});
 const tangents=centerline.map((a,i)=>{const b=centerline[(i+1)%centerline.length];return {x:(b.x-a.x)/lengths[i],z:(b.z-a.z)/lengths[i]};});
 const gates=centerline.map((p,i)=>{
  const a=tangents[(i+tangents.length-1)%tangents.length],b=tangents[i],length=Math.hypot(a.x+b.x,a.z+b.z);
  return {...p,nx:(a.x+b.x)/length,nz:(a.z+b.z)/length,halfWidth:13};
 });
 const offset=distance=>gates.map((p,i)=>{const t=tangents[i],scale=distance/(p.nx*t.x+p.nz*t.z);return {x:p.x-p.nz*scale,z:p.z+p.nx*scale};});
 const boundary={outer:offset(-14),inner:offset(14)};
 const bounds={minX:-154,maxX:142,minZ:-112,maxZ:118};
 const blocks=[],structures=[],props=[],navNodes=[];
 rails(blocks,boundary.outer,'outer');rails(blocks,boundary.inner,'inner');
 fillNonDriving(blocks,boundary.outer,bounds,false,'race-apron');
 fillNonDriving(blocks,boundary.inner,bounds,true,'race-infield');
 const trackPoint=(index,t,lane=0)=>{
  const a=centerline[index],b=centerline[(index+1)%centerline.length],dir=tangents[index];
  return {x:a.x+(b.x-a.x)*t-dir.z*lane,z:a.z+(b.z-a.z)*t+dir.x*lane};
 };
 const grid=Array.from({length:8},(_,id)=>({x:-44-6*Math.floor(id/2),z:-68+(id%2?3:-3),heading:Math.PI/2}));
 // Separated rewards: boxes down the middle; coin rows pull toward the apex.
 const itemBoxes=[0,1,2,3,4,6,7,9,10,12,13,15].map((index,id)=>({id:`ion-box-${id}`,...trackPoint(index,.56)}));
 const boostPads=[[0,.2],[0,.84],[2,.15],[4,.16],[7,.13],[9,.15],[10,.88],[12,.16],[13,.82],[15,.13]]
  .map(([index,t],id)=>({id:`ion-boost-${id}`,...trackPoint(index,t)}));
 const coins=[];
 for(const [index,lane] of [[0,4],[2,-4],[3,-4],[5,4],[7,4],[8,-4],[9,-4],[11,4],[13,4],[16,4]]){
  for(const t of [.32,.43,.54])coins.push({id:`ion-coin-${coins.length}`,...trackPoint(index,t,lane)});
 }
 for(let i=0;i<centerline.length;i++){
  const steps=Math.ceil(lengths[i]/3);
  for(let j=0;j<steps;j++)navNodes.push(trackPoint(i,j/steps));
 }
 navNodes.push(...grid.map(({x,z})=>({x,z})),...itemBoxes.map(({x,z})=>({x,z})));

 // The filled infield/apron is a 3 m plinth. Every prop and structure is
 // grounded on that plinth, with generous clearance from the driving ribbon.
 building(blocks,structures,-30,-4,18,16,23,{base:3,windows:['north','south','east','west']});
 for(const x of [-72,-46,-20,6,32]){
  building(blocks,structures,x,-96,20,12,6,{base:3,windows:['south']});
  props.push({type:'crate',x:x-5,y:3,z:-86,scale:1.4,seed:props.length},{type:'barrel',x:x+5,y:3,z:-86,scale:1.2,seed:props.length+1});
 }
 // Broad continuous bleacher tiers overlook the recessed return straight.
 for(let tier=0;tier<4;tier++)blocks.push(solid(-18,86+tier*4,52,4,5+tier*2,'soccer-wall'));
 for(const x of [-44,8])lightMast(blocks,structures,x,105,19,'north',3);
 for(const x of [-84,44])lightMast(blocks,structures,x,-104,17,'south',3);
 // Three grounded induction arches form the speedway's infield landmark.
 for(const z of [-22,-4,14]){
  structures.push({type:'arch',x:22,y:3,z,width:24,height:10,rot:0});
  for(const x of [10,34])blocks.push(solid(x,z,.8,.8,13,'race-rail'));
 }
 for(const [x,z,scale] of [[-82,-12,3],[-74,6,4],[-68,24,3],[-6,24,2.5],[40,28,3],[48,40,2.5]]){
  props.push({type:'rock',x,y:3,z,scale,seed:props.length});
 }
 return {
  id:'ion-speedway',name:'Ion Speedway',tag:'ROAD COURSE / PUMA',
  description:'Launch past the ion gantries, thread the eastern dogleg, and sweep through a recessed grandstand straight on a purpose-built road course.',
  arena:{group:'vehicle',scale:'battle',play:['puma-race']},collection:'destinations',
  color:'#6de8ee',background:'#111b2c',floorColor:'#303846',sky:'night',raised:false,nextGen:true,bounds,
  blocks,structures,props,spawns:grid.map(({x,z})=>[x,z]),pickups:[],navNodes,vehicles:vehicles(grid),
  race:{centerline,gates,grid,itemBoxes,boostPads,coins,boundary},
 };
}

function auroraStadium(){
 const bounds={minX:-74,maxX:74,minZ:-60,maxZ:60};
 const pitch={minX:-44,maxX:44,minZ:-24,maxZ:24};
 const goals=[-1,1].map((side,team)=>({team,x:side*44,z:0,nx:side,nz:0,halfWidth:7,height:5,depth:4}));
 const team0=[[-32,-9],[-32,9]],team1=team0.map(([x,z])=>[-x,z]);
 const grid=[...team0.map(([x,z])=>({x,z,heading:Math.PI/2})),...team1.map(([x,z])=>({x,z,heading:-Math.PI/2}))];
 const blocks=[],structures=[],props=[],navNodes=[];
 // Inner board faces match the analytic ball bounds exactly. The 14 m goal
 // mouths have thin posts and a full 4 m net pocket, enough for a radius-1.1
 // ball to cross the scoring plane before encountering the back wall.
 for(const side of [-1,1]){
  blocks.push(solid(0,side*24.6,90.4,1.2,3,'soccer-wall'));
  for(const end of [-1,1])blocks.push(solid(side*44.6,end*15.8,1.2,17.6,3,'soccer-wall'));
  for(const end of [-1,1]){
   blocks.push(solid(side*44,end*7,.2,.2,5,'soccer-goal'));
   blocks.push(solid(side*46,end*7,4.2,.2,5,'soccer-goal'));
  }
  blocks.push(solid(side*48,0,.2,14.2,5,'soccer-goal'));
 }
 // The rendered barrier loop encloses the whole stadium, not the goal mouths.
 // Pitch boards and visible nets use their dedicated presentation above.
 const boundary={outer:[[-72,-58],[72,-58],[72,58],[-72,58]].map(point),inner:[]};
 for(const side of [-1,1]){
  blocks.push(solid(side*72,0,1.2,117.2,2.7,'race-rail'));
  blocks.push(solid(0,side*58,145.2,1.2,2.7,'race-rail'));
 }

 // Twin stepped stands, canopy wings and a rear concourse. All collision is
 // outside the pitch; the turf remains a flat, empty, reflection-symmetric box.
 for(const side of [-1,1]){
  for(let tier=0;tier<4;tier++){
   const z=side*(30+tier*4),h=3+tier*2;
   blocks.push(solid(0,z,100,4,h,'soccer-wall'));
   // Thin roof caps read as continuous bench rows rather than many small seats.
   structures.push({type:'building',x:0,y:0,z,w:100,d:3,h,roof:'flat',rot:0});
  }
  structures.push({type:'building',x:0,y:0,z:side*43,w:106,d:10,h:16,roof:'flat',rot:0});
  for(const x of [-48,-16,16,48]){
   structures.push({type:'column',x,y:0,z:side*46,radius:.65,height:16});
   blocks.push(solid(x,side*46,1.3,1.3,16,'column'));
  }
  building(blocks,structures,0,side*52,72,6,5,{windows:[side<0?'south':'north']});
  for(const end of [-1,1]){
   lightMast(blocks,structures,end*53,side*24,21,side<0?'south':'north');
   // Four mirrored service bays with grounded equipment on the apron.
   building(blocks,structures,end*61,side*35,12,10,6,{windows:[end<0?'east':'west']});
   props.push({type:'crate',x:end*55,y:0,z:side*43,scale:1.3,seed:4},
    {type:'barrel',x:end*58,y:0,z:side*43,scale:1.2,seed:7});
  }
 }
 // High end-zone arches flank the broadcast pylons, clear of the goal pockets.
 for(const side of [-1,1]){
  structures.push({type:'arch',x:side*60,y:0,z:0,width:26,height:10,rot:Math.PI/2});
  for(const z of [-13,13])blocks.push(solid(side*60,z,.8,.8,10,'race-rail'));
  building(blocks,structures,side*65,0,4,18,17,{windows:[side<0?'east':'west']});
  for(const z of [-20,20])props.push({type:'iceSpike',x:side*64,y:0,z,scale:2.5,seed:3});
 }
 // A connected 4 m lattice includes both kickoff slots. Inset rectangle nodes
 // also keep the soccer centerline clear of the physical board corners.
 for(let x=-40;x<=40;x+=4)for(let z=-20;z<=20;z+=4)navNodes.push({x,z});
 navNodes.push(...grid.map(({x,z})=>({x,z})));
 const centerline=[[-40,-20],[40,-20],[40,20],[-40,20]].map(point);
 return {
  id:'aurora-stadium',name:'Aurora Stadium',tag:'STADIUM / PUMA',
  description:'A broad floodlit pitch beneath twin canopy stands, crystalline end-zone monuments, and soaring broadcast arches. Four Pumas, one ball, room to build a counterattack.',
  arena:{group:'vehicle',scale:'battle',play:['puma-soccer']},collection:'destinations',
  color:'#8feadf',background:'#101a30',floorColor:'#263746',sky:'night',raised:false,nextGen:true,bounds,
  blocks,structures,props,spawns:[...team0,...team1],teamSpawns:{0:team0,1:team1},pickups:[],navNodes,vehicles:vehicles(grid),
  race:{kind:'soccer',pitch,goals,ball:{x:0,y:1.1,z:0,r:1.1},centerline,gates:[],grid,boundary},boundary,
 };
}

export const DESTINATION_SPORTS_MAPS=freeze([ionSpeedway(),auroraStadium()]);
