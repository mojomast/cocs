import test from 'node:test';
import assert from 'node:assert/strict';
import {destinationDetails} from './destination-details.mjs';
import {DESTINATION_MAPS} from './destination-maps.mjs';
import {terrainFootprintRange} from './terrain.mjs';

// Contract ceilings, not measured map counts or performance assertions. Keep
// fixtures independent of the changing number/placement of authored buildings.
const BUDGET={facades:2700,paint:160,signs:24,boxes:2884,labels:8,newMaterials:4,batchMaterials:6};
const EPS=1e-7;
const THEMES=['urban','ruins','volcanic','snow','canyon','orbital','forest-dam','sports'];

// Preserve function identity too: JSON alone would miss a replaced height
// query. Inputs are plain authored data, including frozen destination exports.
function snapshot(value,seen=new Map()){
 if(!value||typeof value!=='object')return value;
 if(seen.has(value))return seen.get(value);
 const copy=Array.isArray(value)?[]:{};seen.set(value,copy);
 for(const key of Object.keys(value))copy[key]=snapshot(value[key],seen);
 return copy;
}

function resource(id,properties={}){
 return {id,...properties,disposeCount:0,dispose(){this.disposeCount++;}};
}

function record(arena,{canvasLabels=false}={}){
 const existing=resource('existing'),trim=resource('trim'),glow=resource('glow');
 const palette=[existing,trim,glow],created=[],boxes=[],labels=[],textures=[];
 const world={add(){assert.fail('construction must use supplied batching/label callbacks');}};
 const stats=destinationDetails(world,arena,{
  palette,trim,glow,
  material(color,metalness,roughness,emissive=false){
   const mat=resource(`new-${created.length}`,{color,metalness,roughness,emissive});
   created.push(mat);return mat;
  },
  detail(w,h,d,x,y,z,mat){
   assert.ok([w,h,d,x,y,z].every(Number.isFinite),'every emitted box has finite dimensions/position');
   assert.ok(Math.min(w,h,d)>0,'batch boxes have positive volume');
   assert.ok(palette.includes(mat),'material is registered for caller disposal before batching');
   boxes.push({w,h,d,x,y,z,mat});
  },
  textLabel(parent,text,x,y,z,size,color,ry){
   assert.equal(parent,world,'signs use the supplied world');
   assert.ok([x,y,z,size,ry].every(Number.isFinite));assert.ok(size>0);
   labels.push({text,x,y,z,size,color,ry});
   if(!canvasLabels)return null;
   const draws=[],ctx={
    font:'bold 78px monospace',
    measureText(text){return {width:text.length*Number(this.font.match(/[\d.]+/)[0])*.6};},
    clearRect(){draws.length=0;},
    fillText(text,x,y){draws.push({text,x,y,width:this.measureText(text).width});},
   };
   const image={width:512,height:128,getContext:()=>ctx},texture={image,needsUpdate:false,draws};
   textures.push(texture);return {material:{map:texture}};
  },
 });
 return {stats,boxes,labels,created,palette,existing,trim,glow,textures};
}

function signature(result){
 return {stats:result.stats,boxes:result.boxes.map(({mat,...box})=>({...box,material:mat.id})),
  labels:result.labels,materials:result.created.map(({id,color,metalness,roughness,emissive})=>({id,color,metalness,roughness,emissive}))};
}

function withinBudget(r){
 assert.ok(r.stats,'destination is recognized');
 assert.equal(r.stats.boxes,r.boxes.length,'diagnostics agree with actual callback count');
 assert.equal(r.stats.labels,r.labels.length);
 assert.equal(r.stats.facadeBoxes+r.stats.paintBoxes+r.stats.signBoxes,r.boxes.length);
 assert.ok(r.stats.facadeBoxes<=BUDGET.facades);
 assert.ok(r.stats.paintBoxes<=BUDGET.paint);
 assert.ok(r.stats.signBoxes<=BUDGET.signs);
 assert.ok(r.stats.signBoxes<=r.labels.length*3);
 assert.ok(r.boxes.length<=BUDGET.boxes);
 assert.ok(r.labels.length<=BUDGET.labels);
 assert.equal(r.created.length,BUDGET.newMaterials);
 assert.equal(r.stats.newMaterials,r.created.length);
 assert.ok(new Set(r.boxes.map(b=>b.mat)).size<=BUDGET.batchMaterials);
 assert.deepEqual(r.palette.slice(0,3),[r.existing,r.trim,r.glow],'existing disposal entries are preserved');
 for(const mat of r.created){
  assert.equal(r.palette.filter(entry=>entry===mat).length,1,'new material is registered exactly once');
  assert.equal(mat.disposeCount,0,'helper leaves resource lifetime to the caller');
 }
 // Simulate the caller's palette disposal, not a WebGL scene/resource test.
 for(const mat of r.palette)mat.dispose();
 for(const mat of r.created)assert.equal(mat.disposeCount,1,'every created material is reachable by disposal');
}

const paintOf=r=>r.boxes.filter(b=>b.h<.02);
const footprint=b=>[[b.x-b.w/2,b.z-b.d/2],[b.x+b.w/2,b.z-b.d/2],[b.x+b.w/2,b.z+b.d/2],[b.x-b.w/2,b.z+b.d/2]];
const fits=(center,half,min,max)=>center-half>=min-EPS&&center+half<=max+EPS;
const overlaps=(a,b)=>Math.abs(a.x-b.x)<(a.w+b.w)/2-EPS&&Math.abs(a.z-b.z)<(a.d+b.d)/2-EPS;

// Independent geometric oracle: the entire rectangle must fit on ONE solid
// face. A union of two door jambs is deliberately not sufficient support.
function attached(box,b){
 if(!fits(box.y,box.h/2,(b.y??0)+.1,b.h-.1))return false;
 for(const axis of ['x','z']){
  const size=axis==='x'?'w':'d',other=axis==='x'?'z':'x',otherSize=axis==='x'?'d':'w';
  if(box[size]>.03+EPS||!fits(box[other],box[otherSize]/2,b[other]-b[otherSize]/2+.1,b[other]+b[otherSize]/2-.1))continue;
  for(const sign of [-1,1]){
   const distance=(box[axis]-b[axis])*sign-b[size]/2;
   if(distance-box[size]/2>=-EPS&&distance+box[size]/2<=.03+EPS)return true;
  }
 }
 return false;
}

function signAttached(label,b){
 const nx=Math.sin(label.ry),nz=Math.cos(label.ry);
 if(!fits(label.y,label.size/2,b.y??0,b.h))return false;
 if(Math.abs(nx)<EPS)return Math.abs((label.z-b.z)*nz-b.d/2-.03)<EPS
  &&fits(label.x,label.size*2,b.x-b.w/2,b.x+b.w/2);
 if(Math.abs(nz)<EPS)return Math.abs((label.x-b.x)*nx-b.w/2-.03)<EPS
  &&fits(label.z,label.size*2,b.z-b.d/2,b.z+b.d/2);
 return false;
}

function assertSupportedPaint(arena,r){
 const paint=paintOf(r);assert.equal(paint.length,r.stats.paintBoxes,'only floor paint is horizontally thin');
 for(const box of paint){
  const support=terrainFootprintRange(arena.terrain,footprint(box));
  assert.ok(support,'paint has actual triangle support');
  assert.ok(Math.abs(support.area-box.w*box.d)<1e-5,'entire footprint is supported exactly once');
  assert.ok(support.max-support.min<1e-5,'entire footprint is flat');
  assert.ok(box.y-box.h/2>=support.max-EPS&&box.y+box.h/2<=support.max+.03+EPS,'paint is shallow and above its floor');
  assert.ok(!(arena.blocks??[]).some(b=>overlaps(box,b)),'paint never crosses a collision footprint');
 }
}

function fixture(extra={}){
 return {id:'detail-fixture',collection:'destinations',destination:{theme:'urban'},
  blocks:[],structures:[],landmarks:[],...extra};
}

function rectangle(x0,x1,z0,z1,y=0,walkable=true){
 const height=typeof y==='function'?y:()=>y;
 return {material:'concrete',walkable,
  vertices:[[x0,height(x0,z0),z0],[x0,height(x0,z1),z1],[x1,height(x1,z1),z1],[x1,height(x1,z0),z0]],
  triangles:[[0,1,2],[0,2,3]]};
}
const terrain=surfaces=>({height:()=>0,surfaces,walls:[],base:0});
const floorFixture=(surfaces,extra={})=>fixture({terrain:terrain(surfaces),routes:[{points:[[0,0],[6,0]]}],...extra});

for(const map of DESTINATION_MAPS)test(`${map.id}: deterministic bounded dressing, registered materials and unchanged simulation data`,()=>{
 const before=snapshot(map),first=record(map),second=record(map);
 assert.deepEqual(signature(first),signature(second),'rebuild uses identical geometry, signs and material parameters');
 assert.deepEqual(map,before,'all authored geometry, markers, navigation, routes and height functions stay unchanged');
 withinBudget(first);withinBudget(second);
 assert.ok(first.boxes.length>0,'current destination has visible surface construction');
 for(const box of first.boxes.filter(b=>b.h>=.02))assert.ok(map.blocks.some(b=>attached(box,b)),'cladding stays within one existing solid facade');
 for(const label of first.labels)assert.ok(map.blocks.some(b=>signAttached(label,b)),'wayfinding is mounted on a solid, facing outward');
 assertSupportedPaint(map,first);
});

test('oversized authored input exercises box, paint and label caps without starving distant facades',()=>{
 const blocks=Array.from({length:300},(_,i)=>({x:i*60,z:80,w:40,d:8,h:20,kind:'wall'}));
 const arena=fixture({blocks,terrain:terrain([rectangle(-100,19000,-10,120)]),
  routes:[{points:[[0,0],[18000,0]]}],
  landmarks:blocks.slice(0,12).map((b,i)=>({x:b.x,z:b.z+10,label:`FACILITY ${i}`}))});
 const before=snapshot(arena),r=record(arena);
 withinBudget(r);
 assert.ok(r.stats.facadeBoxes>1000,'fixture actually stresses architectural allocation');
 assert.equal(r.stats.paintBoxes,BUDGET.paint,'long supported road reaches the paint cap');
 assert.equal(r.labels.length,BUDGET.labels,'more eligible landmarks than available signs');
 assert.ok(r.boxes.some(b=>b.h>=.02&&b.x>blocks.at(-1).x*.9),'allocation reaches the far end of a dense map');
 assert.deepEqual(arena,before,'mutable input is also left unchanged');
});

for(const theme of THEMES)test(`${theme}: facade layers and signs never bridge either orientation of door gap`,()=>{
 const blocks=[
  {x:-4.5,z:0,w:5,d:.6,h:6,kind:'building'},
  {x:4.5,z:0,w:5,d:.6,h:6,kind:'building'},
  {x:20,z:-4.5,w:.6,d:5,h:4,kind:'building'},
  {x:20,z:4.5,w:.6,d:5,h:4,kind:'building'},
 ];
 const arena=fixture({destination:{theme},blocks,
  landmarks:[{label:'NORTH ARRIVALS',x:0,z:6},{label:'EAST SERVICE',x:26,z:0}]});
 const r=record(arena),doors=[{x:0,z:0,w:4,d:.66},{x:20,z:0,w:.66,d:4}];
 assert.ok(r.boxes.length>0);assert.ok(r.labels.length>0);
 assert.equal(r.stats.paintBoxes,0);
 for(const b of blocks)assert.ok(r.boxes.some(box=>attached(box,b)),'both wall segments of each door receive dressing');
 for(const box of r.boxes){
  assert.ok(blocks.some(b=>attached(box,b)),'whole component is clipped to one wall');
  assert.ok(!doors.some(door=>overlaps(box,door)),'a real four-metre mouth remains completely open');
 }
 for(const label of r.labels)assert.ok(blocks.some(b=>signAttached(label,b)),'label plane fits entirely on one jamb facade');
});

test('landmark signs use all four outward normals and fit long names into existing label textures',()=>{
 const rotations=[0,Math.PI/2,Math.PI,-Math.PI/2];
 const blocks=rotations.map((_,i)=>({x:i*60,z:0,w:8,d:6,h:7,kind:'building'}));
 const landmarks=blocks.map((b,i)=>({x:b.x+Math.sin(rotations[i])*10,z:b.z+Math.cos(rotations[i])*10,
  label:`SECTOR ${i} / LONG DISTANCE FREIGHT OPERATIONS`}));
 const r=record(fixture({blocks,landmarks}),{canvasLabels:true});
 assert.equal(r.labels.length,4);
 for(const [i,label] of r.labels.entries()){
  assert.ok(signAttached(label,blocks[i]));
  assert.ok(Math.abs(Math.sin(label.ry)-Math.sin(rotations[i]))<EPS);
  assert.ok(Math.abs(Math.cos(label.ry)-Math.cos(rotations[i]))<EPS);
  const texture=r.textures[i];assert.equal(texture.needsUpdate,true);
  assert.equal(texture.draws.map(d=>d.text).join(' '),landmarks[i].label,'no place-name words are cropped away');
  assert.ok(texture.draws.every(d=>d.width<=texture.image.width-24+EPS&&d.y>0&&d.y<texture.image.height));
 }
});

test('legacy and unsupported destinations allocate no resources and emit no callbacks',()=>{
 const block={x:0,z:0,w:8,d:4,h:6,kind:'wall'};
 for(const arena of [
  fixture({id:'meridian-exchange',collection:'legacy',blocks:[block]}),
  fixture({collection:undefined,blocks:[block]}),
  fixture({destination:{theme:'unknown'},blocks:[block]}),
 ]){
  const before=snapshot(arena),r=record(arena);
  assert.equal(r.stats,undefined);
  assert.deepEqual(r.boxes,[]);assert.deepEqual(r.labels,[]);assert.deepEqual(r.created,[]);
  assert.equal(r.palette.length,3);assert.deepEqual(arena,before);
 }
});

test('hidden curved/prop proxies and terrain/race proxies cannot acquire box facades or signs',()=>{
 const kinds=['column','tree','rock','crate','cave','tunnel','foundation','ramp','rampwall',
  'deck','terrace','race-rail','race-apron','race-infield','soccer-goal','light-mast'];
 const blocks=kinds.map((kind,i)=>({x:i*30,z:0,w:8,d:4,h:6,kind}));
 blocks.push({x:kinds.length*30,z:0,w:8,d:4,h:6,kind:'wall',propType:'barrel'});
 const arena=fixture({blocks,landmarks:blocks.map(b=>({x:b.x,z:8,label:'PROXY LANDMARK'}))}),r=record(arena);
 assert.deepEqual(r.boxes,[]);assert.deepEqual(r.labels,[]);
 assert.equal(r.stats.boxes,0);
 // Positive control prevents a blanket 'skip all blocks' implementation from
 // satisfying the proxy exclusion test.
 const visible={x:-40,z:0,w:8,d:4,h:6,kind:'wall'};
 const mixed=record({...arena,blocks:[visible,...blocks]});
 assert.ok(mixed.boxes.length>0);
 assert.ok(mixed.boxes.every(box=>attached(box,visible)));
});

test('paint is supported at its complete footprint, including across coplanar terrain seams',()=>{
 const arena=floorFixture([rectangle(0,3,-2,2,2),rectangle(3,6,-2,2,2)]),r=record(arena);
 assert.ok(r.stats.paintBoxes>0,'coplanar triangle boundaries do not suppress safe paint');
 assert.equal(r.stats.facadeBoxes,0);assert.equal(r.stats.signBoxes,0);
 assertSupportedPaint(arena,r);
 assert.ok(r.boxes.every(b=>b.y>2&&b.y<2.03),'actual triangle height wins over the deliberately stale height callback');
});

test('paint rejects slopes, interior holes/ridges, missing support and non-walkable surfaces',()=>{
 // Candidate dash is on x=3. This tiny cut is inside its footprint, away from
 // both the centre and all four corners; height() intentionally still says 0.
 const aroundCut=[rectangle(0,3.3,-2,2),rectangle(3.5,6,-2,2),
  rectangle(3.3,3.5,-2,-.02),rectangle(3.3,3.5,.02,2)];
 const bump={material:'concrete',walkable:true,
  vertices:[[3.3,0,-.02],[3.3,0,.02],[3.5,0,.02],[3.5,0,-.02],[3.4,.3,0]],
  triangles:[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]};
 for(const [name,surfaces] of [
  ['slope',[rectangle(0,6,-2,2,x=>x*.15)]],
  ['interior hole',aroundCut],['interior ridge',[...aroundCut,bump]],
  ['absent floor',[]],['non-walkable ceiling',[rectangle(0,6,-2,2,0,false)]],
 ]){
  const r=record(floorFixture(surfaces));
  assert.equal(r.stats.paintBoxes,0,name);assert.deepEqual(r.boxes,[],name);
 }
});

test('paint avoids door interiors, ramp approaches, service decks and collision footprints on otherwise flat ground',()=>{
 for(const [name,extra] of [
  ['rotated building',{structures:[{type:'building',x:3,z:0,w:6,d:2,rot:Math.PI/2}]}],
  ['open compound',{structures:[{type:'compound',x:3,z:0,w:4,d:4}]}],
  ['causeway approach',{structures:[{type:'causeway',x:20,z:0,w:4,d:4,accessPath:[[0,0,0],[20,2,0],[40,0,0]]}]}],
  ['service deck approach',{destination:{theme:'urban',serviceDecks:[{x:15,z:0,length:10,width:4,ramp:15}]}}],
  ['hidden collision footprint',{blocks:[{x:3,z:0,w:1,d:1,h:4,kind:'column'}]}],
 ]){
  const r=record(floorFixture([rectangle(-10,50,-10,10)],extra));
  assert.equal(r.stats.paintBoxes,0,name);
 }
 // A doorway reservation must not suppress the entire surrounding street.
 const arena=floorFixture([rectangle(-30,30,-10,10)],{
  routes:[{points:[[-24,0],[24,0]]}],structures:[{type:'building',x:0,z:0,w:14,d:8,doors:['west','east']}]});
 const r=record(arena);assert.ok(r.stats.paintBoxes>0);
 for(const box of paintOf(r))assert.ok(!overlaps(box,{x:0,z:0,w:16.8,d:10.8}),'including the clear doorway and its doorstep');
 assertSupportedPaint(arena,r);
});

test('sports floors and diagonal roads do not receive misleading axis-aligned paint',()=>{
 const surfaces=[rectangle(-10,10,-10,10)];
 for(const extra of [{race:{}},{routes:[{points:[[0,0],[6,6]]}]}]){
  const r=record(floorFixture(surfaces,extra));
  assert.equal(r.stats.paintBoxes,0);assert.deepEqual(r.boxes,[]);
 }
});
