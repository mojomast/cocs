// A small authored industrial kit. Floors, roofs, ramps and retaining faces use
// the SAME triangle soup for rendering, collision, rays and the M0 floor lattice.
// Roofs are filled service wings, not unsupported walk-under decks.
import {ensureFloorLattice,floorHeightAtLattice} from './floor-lattice.mjs';

const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const mirror=b=>({...b,x:-b.x,z:-b.z});
const pair=(...items)=>items.flatMap(b=>[b,mirror(b)]);
const block=(x,z,w,d,h,kind='foundry-wall')=>({x,z,w,d,h,kind});

// Low siphon courts, a raised outer slag embankment, and two broad diagonal
// swales between compounds. Heights are positive: legacy solids start at y=0.
function baseHeight(x,z){
 const basin=clamp((20-Math.abs(x))/10)*clamp((14-Math.abs(Math.abs(z)-26))/6);
 const berm=clamp((Math.abs(z)-66)/6)*5;
 const swale=clamp((10-Math.abs(Math.abs(x)-82))/8)*clamp((12-Math.abs(z))/8);
 const slagRidge=4*clamp((12-Math.abs(Math.abs(x)-86))/10)*clamp((8-Math.abs(Math.abs(z)-28))/6);
 return 4-3*basin-.8*swale+berm+slagRidge;
}
const roof=(id,x,z,length,width,rise=4,ramp=16)=>({id,x,z,length,width,rise,ramp});
const roofs=pair(roof('hq-roof',-104,-18,12,8,4,8),roof('bastion-roof',-54,-16,20,8),
 roof('freight-roof',-70,-62,12,8),roof('flank-roof',-54,62,20,8));

export function foundryGeometry(){
 const surfaces=new Map(),navNodes=[];
 const surface=(material,walkable=true)=>{
  const id=material+(walkable?'':'-retaining');
  if(!surfaces.has(id))surfaces.set(id,{id,material,walkable,vertices:[],triangles:[]});
  return surfaces.get(id);
 };
 const quad=(points,material='concrete',walkable=true)=>{
  const s=surface(material,walkable),n=s.vertices.length;s.vertices.push(...points);s.triangles.push([n,n+1,n+2],[n,n+2,n+3]);
 };
 const roofAt=(x,z)=>roofs.find(r=>Math.abs(z-r.z)<r.width/2&&Math.abs(x-r.x)<r.length/2+r.ramp);
 const heightOn=(r,x,z)=>r?4+r.rise*clamp((r.length/2+r.ramp-Math.abs(x-r.x))/r.ramp):baseHeight(x,z);
 const materialAt=(x,z,r)=>r?'metal':Math.abs(z)>=58?'ash':Math.abs(z)>=44&&Math.abs(z)<=56?'metal':
  Math.abs(x)<20&&Math.abs(z)>14&&Math.abs(z)<40?'stone':Math.abs(z)<12?'concrete':'rock';
 // Two metre tiles resolve door aprons and basin shoulders; diagonal choice is
 // invariant under a 180 degree rotation. No noise, clock or runtime generation.
 for(let x=-120;x<120;x+=2)for(let z=-72;z<72;z+=2){
  const r=roofAt(x+1,z+1),h=(a,b)=>heightOn(r,a,b);
  quad([[x,h(x,z),z],[x,h(x,z+2),z+2],[x+2,h(x+2,z+2),z+2],[x+2,h(x+2,z),z]],materialAt(x+1,z+1,r));
 }
 // Lateral skirts are real vertical ray surfaces. Ground collision uses the
 // height discontinuity; no invisible ceiling/walk-under fiction is introduced.
 for(const r of roofs){
  const lo=Math.max(-120,r.x-r.length/2-r.ramp),hi=Math.min(120,r.x+r.length/2+r.ramp);
  for(let x=lo;x<hi;x+=2)for(const sign of [-1,1]){
   const z=r.z+sign*r.width/2,a=heightOn(r,x,z),b=heightOn(r,x+2,z),c=baseHeight(x,z),d=baseHeight(x+2,z);
   if(Math.max(Math.abs(a-c),Math.abs(b-d))<1e-8)continue;
   // Separate triangles avoid a degenerate triangle at a ramp toe.
   const s=surface('concrete',false),p=[[x,c,z],[x,a,z],[x+2,b,z],[x+2,d,z]];
   for(const ids of [[0,1,2],[0,2,3]]){
    if(ids[1]===1&&Math.abs(a-c)<1e-8||ids[1]===2&&Math.abs(b-d)<1e-8)continue;
    const n=s.vertices.length;
    // Retaining faces point outward on both sides of the wing (the terrain
    // renderer uses front faces, while collision rays are two-sided).
    s.vertices.push(...(sign>0?ids.slice().reverse():ids).map(i=>p[i]));s.triangles.push([n,n+1,n+2]);
   }
  }
  // Both ramp toes and the roof spine are explicit bot anchors (6m grid alone
  // can miss an 8m-wide terrace). No jump/teleport links needed to reach a roof.
  for(let x=lo+2;x<hi;x+=4)navNodes.push({x,z:r.z});
 }
 const terrain={surfaces:[...surfaces.values()],walls:[],maxSlope:.9,base:4,amplitude:8,cell:2};
 terrain.height=(x,z)=>floorHeightAtLattice(ensureFloorLattice(terrain),x,z,terrain.maxSlope);
 const blocks=[
  // HQ courtyard: offset blast screen blocks spawn fire; two side gates and a
  // front dogleg remain open. The north service wing has a double-ended roof.
  ...pair(block(-118,-12,4,4,10,'base-hq'),block(-118,12,4,4,10,'base-hq'),
   block(-106,-10,16,2,10,'base-hq'),block(-106,14,20,2,10,'base-hq'),
   block(-100,0,3,10,11,'base-hq'),block(-108,8,5,2,5.5,'foundry-cover'),
   block(-104,-18,10,6,8,'foundation')),
  // Front bastions: four buttresses, broken lateral walls, ground gates in all
  // four directions; north-west wing offers exposed rail pickup on its roof.
  ...pair(block(-64,-7,3,6,11,'base-bastion'),block(-44,-7,3,6,11,'base-bastion'),
   block(-64,7,3,6,11,'base-bastion'),block(-44,7,3,6,11,'base-bastion'),
   block(-60,12,8,2,8,'base-bastion'),block(-48,12,4,2,8,'base-bastion'),
   block(-58,3,4,2,5.5,'foundry-cover'),block(-54,-16,18,6,8,'foundation')),
  // Relay hall: cruciform entrances, corner furnace towers, split boiler walls.
  ...pair(block(-10,-10,5,5,17,'relay-stack'),block(-10,10,5,5,17,'relay-stack'),
   block(-14,-5,2,6,9,'relay-wall'),block(-14,5,2,6,9,'relay-wall'),
   block(-5,-14,6,2,9,'relay-wall'),block(5,-14,6,2,9,'relay-wall'),
   block(-6,4,3,2,5.5,'foundry-cover')),
  // Siphon courts lie 3m below the relay. Paired pump stacks and retaining
  // galleries leave four broad approaches; centre is clear for capture/loot.
  ...pair(block(-9,26,4,8,10,'siphon-pump'),block(9,26,4,8,10,'siphon-pump'),
   block(-5,35,6,2,5,'siphon-wall'),block(5,35,6,2,5,'siphon-wall'),
   block(-4,22,3,2,2.8,'foundry-cover')),
  // Depot service sheds: open X-axis vehicle bays, protected office wings.
  ...[-100,-70].flatMap(x=>pair(block(x-7,-58,3,4,11,'depot-pier'),block(x+7,-58,3,4,11,'depot-pier'),
   block(x,-59,10,2,9,'depot-wall'),block(x-7,-42,3,4,9,'depot-pier'),block(x+7,-42,3,4,9,'depot-pier'))),
  ...pair(block(-70,-62,10,6,8,'foundation'),block(-54,62,18,6,8,'foundation')),
  // Offset freight baffles force readable 8m-wide bends and stop map-long rays.
  ...pair(block(-82,0,4,6,8,'freight-container'),block(-28,-6,4,8,9,'freight-container'),
   block(-30,0,3,6,9,'freight-container'),
   block(-42,-34,8,3,7,'freight-container'),block(-82,30,8,3,11,'freight-container'),
   block(-16,-50,3,12,10,'freight-container'),block(44,-50,3,12,10,'freight-container'),
   block(-108,40,4,6,8,'freight-container'),block(-32,34,3,6,7,'foundry-cover')),
  ...pair(block(-40,56,1,1,10,'zip-mast'),block(-6,42,1,1,10,'zip-mast'),
   block(-88,56,1,1,10,'zip-mast'),block(-60,42,1,1,10,'zip-mast')),
 ];
 const compounds=[...pair({id:'hq',kind:'hq',x:-108,z:0},{id:'bastion',kind:'front',x:-54,z:0},
  {id:'siphon',kind:'economy',x:0,z:25},{id:'hq-depot',kind:'depot',x:-100,z:-50},
  {id:'forward-depot',kind:'depot',x:-70,z:-50}),{id:'relay',kind:'relay',x:0,z:0}]
  .map((s,i)=>({...s,id:`${s.id}-${i}`,y:terrain.height(s.x,s.z)}));
 for(const c of compounds)for(const [dx,dz] of [[0,0],[0,6],[0,-6],[6,0],[-6,0]])navNodes.push({x:c.x+dx,z:c.z+dz});
 // Four slag ridges offer an additional exposed overlook between HQ and front.
 // Finer local nodes let ordinary bots climb their diagonal shoulders too.
 for(const sx of [-1,1])for(const sz of [-1,1])for(const x of [78,82,86,90,94])for(const z of [20,24,28,32,36])navNodes.push({x:sx*x,z:sz*z});
 return {terrain,blocks,navNodes,foundry:{roofs,compounds}};
}
