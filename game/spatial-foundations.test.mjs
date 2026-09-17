import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from './structures.mjs';
import {createLevel,terrainField} from './levelgen.mjs';
import * as Terrain from './terrain.mjs';
import {buildInteriors,interiorAt,interiorCenter} from './interiors.mjs';
import {validateMapSchema} from './map-schema.mjs';

test('schema rejects invalid spatial contracts without reinterpreting legacy block metadata',()=>{
 const map={id:'spatial-schema',name:'Spatial',bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},blocks:[{x:0,z:0,w:2,d:2,h:7,y:4,minY:4}],spawns:[],pickups:[],navNodes:[]};
 assert.deepEqual(validateMapSchema(map),[]);
 assert.ok(validateMapSchema({...map,structures:[{type:'tunnel',radius:3,floorPoints:[[0,NaN,0],[1,2,0]]}]}).some(e=>e.includes('floorPoints')));
 assert.ok(validateMapSchema({...map,structures:[{type:'tunnel',radius:3,floorPoints:[[0,0,0],[0,2,0]]}]}).some(e=>e.includes('horizontal')));
 assert.ok(validateMapSchema({...map,structures:[{type:'windows',frame:{span:-2,height:4}}]}).some(e=>e.includes('frame')));
 assert.ok(validateMapSchema({...map,structures:[{type:'cavern',openSegments:[16,-1]}]}).some(e=>e.includes('openSegments')));
});

const geometryWalk=(map,a,b)=>{
 let previous=Terrain.terrainSupportAt(a.x,a.z,map.terrain)?.y;
 const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.1);
 for(let i=0;i<=n;i++){
  const x=a.x+(b.x-a.x)*i/n,z=a.z+(b.z-a.z)*i/n,y=Terrain.terrainSupportAt(x,z,map.terrain,map.terrain.maxSlope??.9)?.y;
  assert.ok(Number.isFinite(y),'supported route');assert.ok(Math.abs(y-previous)<.25,`step ${y-previous}`);previous=y;
  assert.equal(map.blocks.some(b=>Math.abs(x-b.x)<b.w/2+.52&&Math.abs(z-b.z)<b.d/2+.52&&y<b.h-1e-6),false,`blocked at ${x},${y},${z}`);
 }
};

test('raised foundation has a supported doorway approach, not an impassable lip',()=>{
 const map=createLevel({id:'spatial-door',amplitude:0,relief:0,layout(c){c.addBuilding({x:0,z:0,w:10,d:8,y:2,door:'south'});}});
 geometryWalk(map,{x:0,z:15},{x:0,z:0});
});

test('authored tunnel floor replaces higher terrain and is shared with interior volume',()=>{
 const map=createLevel({id:'spatial-tunnel',amplitude:0,relief:0,base:9,layout(c){c.addTunnel([[-12,3,0],[0,4,0],[12,5,4]],3);}});
 const s=map.structures.find(s=>s.type==='tunnel');
 assert.deepEqual(s.floorPoints,[[-12,3,0],[0,4,0],[12,5,4]]);
 for(let i=0;i<s.floorPoints.length-1;i++){
  const a=s.floorPoints[i],b=s.floorPoints[i+1];
  for(let k=1;k<10;k++){const t=k/10;near(Terrain.terrainSupportAt(a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t,map.terrain).y,a[1]+(b[1]-a[1])*t);}
 }
 geometryWalk(map,{x:-11,z:0},{x:-1,z:0});
 const interiors=buildInteriors([s]),v=interiorAt(interiors,{x:-6,y:5,z:0});
 assert.ok(v);near(interiorCenter(v,{x:-6,y:5,z:0}).y,3.5);
 assert.equal(interiorAt(interiors,{x:-6,y:3,z:0}),null,'below the authored floor is outside');
});

test('cavern portals connect an authored crossing tunnel, independent of builder order',()=>{
 for(const reverse of [false,true]){
  const map=createLevel({id:'spatial-portal',amplitude:0,relief:0,base:2,layout(c){
   const cave=()=>c.addCavern({x:0,z:0,radius:8,height:7});
   const tunnel=()=>c.addTunnel([[0,2,-20],[0,2,20]],3);
   if(reverse){tunnel();cave();}else{cave();tunnel();}
  }});
  const cave=map.structures.find(s=>s.type==='cavern');
  assert.ok(cave.openSegments.includes(4)&&cave.openSegments.includes(12));
  geometryWalk(map,{x:0,z:-18},{x:0,z:18});
  const tunnel=map.structures.find(s=>s.type==='tunnel');
  const paths=S.tunnelRenderPaths(tunnel,map.structures);
  assert.equal(paths.length,2,'shell must not run through the cavern interior');
  for(const path of paths)for(const p of path)assert.ok(Math.hypot(p[0],p[2])>=8-1e-7);
 }
});

test('terrain edits retain polygon wall ray collision outside the footprint',()=>{
 const terrain=terrainField({minX:-20,maxX:20,minZ:-20,maxZ:20},{step:10,amplitude:0,relief:0});
 terrain.walls=[{vertices:[[-10,0,0],[10,0,0],[10,5,0],[-10,5,0]]}];
 near(Terrain.terrainRayHit([8,2,-4],[0,0,1],10,terrain).distance,4);
 Terrain.stampTerrainFloor(terrain,[[-2,-2],[2,-2],[2,2],[-2,2]],()=>0);
 near(Terrain.terrainRayHit([8,2,-4],[0,0,1],10,terrain)?.distance,4);
 assert.equal(Terrain.terrainRayHit([0,2,-4],[0,0,1],10,terrain),null);
});

test('repeated authored floors retain bounded surface batching and deterministic output',()=>{
 const make=()=>createLevel({id:'spatial-batching',seed:71,amplitude:0,relief:0,base:2,layout(c){for(const x of [-16,0,16])c.addBuilding({x,z:0,w:8,d:8});}});
 const a=make(),b=make();assert.equal(JSON.stringify(a),JSON.stringify(b));
 assert.equal(new Set(a.terrain.surfaces.map(s=>s.id)).size,a.terrain.surfaces.length);
 assert.ok(a.terrain.surfaces.length<=4,'batch by floor kind, not individual stamps');
});

test('default cavern portals remain traversable above surrounding ground',()=>{
 const map=createLevel({id:'spatial-default-portals',amplitude:0,relief:0,layout(c){c.addCavern({x:0,z:0,y:2,radius:8,height:7});}});
 for(const a of [Math.PI/16,Math.PI+Math.PI/16])geometryWalk(map,{x:Math.cos(a)*17,z:Math.sin(a)*17},{x:0,z:0});
});

test('tunnel endpoints have approaches to the exterior ground',()=>{
 const map=createLevel({id:'spatial-tunnel-approach',amplitude:0,relief:0,base:9,layout(c){c.addTunnel([[-12,3,0],[12,3,0]],3);}});
 geometryWalk(map,{x:-35,z:0},{x:0,z:0});
});

test('whole-footprint support catches off-centre interior peaks and stamps exact boundaries',()=>{
 assert.equal(typeof Terrain.terrainFootprintRange,'function');
 const t=terrainField({minX:-12,maxX:12,minZ:-12,maxZ:12},{step:2,height:(x,z)=>x===2&&z===2?7:0,amplitude:0});
 const poly=[[-5,-4],[5,-4],[5,4],[-5,4]];
 const range=Terrain.terrainFootprintRange(t,poly);
 near(range.max,7);near(range.min,0);near(range.area,80);
 Terrain.terrainSupportAt(0,0,t); // prime the cache before editing
 Terrain.stampTerrainFloor(t,poly,()=>7,'foundation');
 for(let x=-4.9;x<5;x+=.7)for(let z=-3.9;z<4;z+=.7)near(Terrain.terrainSupportAt(x,z,t).y,7);
 near(Terrain.terrainSupportAt(5.1,0,t).y,0);
 near(Terrain.terrainRayHit({x:0,y:10,z:0},{x:0,y:-1,z:0},20,t).distance,3);
});

test('building foundation supports entire rotated footprint and compound shares floor height',()=>{
 const terrain=terrainField({minX:-45,maxX:45,minZ:-45,maxZ:45},{step:3,height:(x,z)=>x===3&&z===3?5:2,amplitude:0});
 const before=JSON.stringify(terrain.surfaces);
 const map=createLevel({id:'spatial-foundation',terrain,layout(c){c.addCompound({x:0,z:0,w:12,d:8,rot:Math.PI/2,rooms:[2,2]});}});
 const b=map.structures.find(s=>s.type==='building');
 assert.ok(map.blocks.some(b=>b.kind==='foundation'));near(b.y,5);
 for(let x=-3.9;x<4;x+=.6)for(let z=-5.9;z<6;z+=.6)near(Terrain.terrainSupportAt(x,z,map.terrain).y,b.y);
 for(const p of map.blocks.filter(s=>s.kind==='partition'))near(p.h,b.y+b.h);
 assert.equal(JSON.stringify(terrain.surfaces),before,'authored input is not mutated');
 for(const p of map.blocks)assert.equal(p.minY,undefined,'no elevated legacy block reinterpretation');
});

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
test('facade local frame transforms all sides and keeps details inside wall margins',()=>{
  assert.equal(typeof S.facadeFrame,'function');
  for(let q=0;q<4;q++)for(const side of ['north','south','east','west']){
    const parent={x:13,y:2,z:-7,w:12,d:6,h:7,rot:q*Math.PI/2};
    const frame=S.facadeFrame(parent,side);
    near(Math.hypot(frame.tangent.x,frame.tangent.z),1);
    near(frame.normal.x*frame.tangent.x+frame.normal.z*frame.tangent.z,0);
    assert.ok((frame.origin.x-parent.x)*frame.normal.x+(frame.origin.z-parent.z)*frame.normal.z>0);
    near(frame.span,side==='north'||side==='south'?12:6);
    const windows=S.facadeDetails({frame,rows:3});
    assert.ok(windows.length);
    for(const p of windows){
      const dx=p.x-frame.origin.x,dz=p.z-frame.origin.z;
      near(dx*frame.normal.x+dz*frame.normal.z,.09);
      assert.ok(Math.abs(dx*frame.tangent.x+dz*frame.tangent.z)+p.w/2<=frame.span/2-.35+1e-7);
      assert.ok(p.y-p.h/2>=parent.y+.5 && p.y+p.h/2<=parent.y+parent.h-.5);
    }
  }
  assert.deepEqual(S.facadeDetails({frame:S.facadeFrame({w:1,d:1,h:1},'north'),rows:1}),[]);
});

test('generated windows carry the actual wall frame and normalized parent rotation',()=>{
 const map=createLevel({id:'spatial-facade',amplitude:0,relief:0,layout(c){c.addBuilding({x:0,z:0,w:12,d:6,h:7,rot:1.4});}});
 const building=map.structures.find(s=>s.type==='building');
 near(building.rot,Math.PI/2);
 for(const s of map.structures.filter(s=>s.type==='windows'))assert.deepEqual(s.frame,S.facadeFrame(building,s.side));
});
