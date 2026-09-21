import {terrainFootprintRange} from './terrain.mjs';

// Surface construction only. The caller owns batching, material disposal and
// labels; call once in _buildArena, before detailBatches are flushed.
// Hard ceilings per call: 2,700 facade boxes + 160 paint boxes + 24 sign boxes,
// eight text planes, four new shared materials (six batch materials with the
// supplied trim/glow). No RNG, collision edits, standalone meshes or lights.
const LIMITS={facades:2700,faces:192,paint:160,labels:8};
const THEMES={
 urban:['#628e90','#263c47','#38b5ac','#d6a34d',.3],
 ruins:['#a69d7a','#474f43','#6f8d51','#c6b387',.04],
 volcanic:['#b17755','#343a40','#dca15a','#793f30',.45],
 snow:['#c5dce2','#466577','#77bacc','#e3e9dd',.2],
 canyon:['#b99a72','#554b43','#bb7049','#dac591',.25],
 orbital:['#8c9fae','#2b3f54','#71bacd','#636e9b',.55],
 'forest-dam':['#80978b','#354b45','#5d9d87','#b7a260',.4],
 sports:['#839cae','#293e57','#55b7c1','#c5ab6a',.35],
};
const MAP_THEMES={
 'meridian-exchange':'urban','verdant-reliquary':'ruins','ember-crucible':'volcanic',
 'tidal-citadel':'snow','sunscar-convoy':'canyon','asterion-relay':'orbital',
 'monsoon-foundry':'forest-dam','ion-speedway':'sports','aurora-stadium':'sports',
};
// Curved scenery uses hidden AABB proxies; dressing those boxes would invent
// square silhouettes. Likewise, race rails use a separate smooth wall model.
const SKIP=new Set(['column','tree','rock','crate','cave','tunnel','foundation',
 'ramp','rampwall','deck','terrace','race-rail','race-apron','race-infield','soccer-goal','light-mast']);
const finite=Number.isFinite;
const overlap=(a,b,pad=0)=>Math.abs(a.x-b.x)<(a.w+b.w)/2+pad&&Math.abs(a.z-b.z)<(a.d+b.d)/2+pad;

function facesOf(arena){
 const blocks=arena.blocks??[],faces=[];
 for(const b of blocks){
  if(SKIP.has(b.kind)||b.propType||![b.x,b.z,b.w,b.d,b.h].every(finite)||Math.min(b.w,b.d)<.25)continue;
  const samples=[[b.x,b.z],[b.x-b.w/2,b.z-b.d/2],[b.x+b.w/2,b.z-b.d/2],
   [b.x-b.w/2,b.z+b.d/2],[b.x+b.w/2,b.z+b.d/2]];
  const heights=arena.terrain?samples.map(([x,z])=>arena.terrain.height?.(x,z)).filter(finite):[0];
  if(!heights.length)continue;
  const base=Math.max(0,b.y??0,...heights),height=b.h-base;
  if(height<.65)continue;
  for(const alongX of [true,false]){
   const span=alongX?b.w:b.d,depth=alongX?b.d:b.w;
   // Wall end-grain is already a readable jamb. Never turn it into a sign or
   // machinery panel, and never extend a long face across the adjoining gap.
   if(span<1||span<depth*.35)continue;
   for(const sign of [-1,1]){
    const x=b.x+(alongX?0:sign*b.w/2),z=b.z+(alongX?sign*b.d/2:0);
    const probe={x:x+(alongX?0:sign*.04),z:z+(alongX?sign*.04:0),w:alongX?span-.2:.01,d:alongX?.01:span-.2};
    if(blocks.some(other=>other!==b&&other.h>=b.h-.1&&overlap(probe,other)))continue;
    faces.push({b,alongX,sign,x,z,span,base,height});
   }
  }
 }
 return faces;
}

// All pieces are clipped to ONE solid face with a 10 cm perimeter margin.
// The three construction layers end 10, 18 and 26 mm outside its plane;
// sign backing/ink use 28/29 mm. In-plane extents and height stay inside the
// original collision silhouette, including at the ends of split door walls.
function facePainter(face,emit){
 return (u,v,w,h,mat,layer=0)=>{
  const left=Math.max(-face.span/2+.1,u-w/2),right=Math.min(face.span/2-.1,u+w/2);
  const bottom=Math.max(.1,v-h/2),top=Math.min(face.height-.1,v+h/2);
  if(right-left<.025||top-bottom<.025)return false;
  const offset=layer>=3?(layer===3?.027:.028):.006+Math.max(0,layer)*.008;
  const depth=layer>=3?.002:.008,along=(left+right)/2;
  return emit(face.alongX?right-left:depth,top-bottom,face.alongX?depth:right-left,
   face.x+(face.alongX?along:face.sign*offset),face.base+(bottom+top)/2,
   face.z+(face.alongX?face.sign*offset:along),mat);
 };
}

function dressFace(f,theme,m,emit){
 const p=facePainter(f,emit),s=f.span,h=f.height;
 // Stable districts, rather than a different random pattern on every box.
 const district=((Math.floor(f.b.x/16)+Math.floor(f.b.z/14))%3+3)%3;
 const ink=district===1?m.secondary:m.accent;
 p(0,h/2,s,h,m.skin);
 p(0,h-.27,s,.34,theme==='ruins'?m.secondary:m.trim,1);
 p(0,.34,s,.4,m.dark,1);
 if(h<2.6){
  // Low cover reads as masonry benches, equipment cases or cargo skids.
  p(0,h*.64,s-.5,.28,ink,1);
  const n=Math.min(5,Math.max(1,Math.floor(s/1.7)));
  for(let i=0;i<n;i++)p(-s/2+s*(i+.5)/n,h*.4,.12,h*.42,m.dark,2);
  return;
 }
 const ribs=(count,mat=m.trim)=>{
  for(let i=0;i<=count;i++)p(-s/2+.25+(s-.5)*i/count,h/2,.16,h-.65,mat,2);
 };
 const grille=(u,v,w,hh,count=5,vertical=false)=>{
  p(u,v,w,hh,m.dark,1);
  for(let i=0;i<count;i++)p(u+(vertical?(i-(count-1)/2)*w/count:0),
   v+(vertical?0:(i-(count-1)/2)*hh/count),vertical?.11:w-.16,vertical?hh-.16:.09,m.skin,2);
 };
 const hazard=(v)=>{
  p(0,v,s-.5,.32,m.dark,1);
  const n=Math.min(7,Math.max(2,Math.floor(s/1.1)));
  for(let i=0;i<n;i++)p(-s/2+.35+(s-.7)*(i+.5)/n,v,(s-.7)/n*.5,.24,m.secondary,2);
 };
 if(theme==='ruins'){
  // Broad staggered ashlar courses, a stepped stone frieze and rooted relief.
  const rows=Math.min(4,Math.max(2,Math.floor(h/1.5))),cols=Math.min(4,Math.max(1,Math.floor(s/2.4)));
  for(let row=1;row<=rows;row++){
   const v=.6+(h-1.2)*row/(rows+1);
   p(0,v,s,.065,m.dark,1);
   for(let col=0;col<cols;col++)p(-s/2+(col+.5+(row%2)*.45)*s/cols,v-(h-1.2)/(rows+1)/2,.065,(h-1.2)/(rows+1),m.dark,1);
  }
  const root=(district-1)*s*.2;
  p(root,h*.46,.24,h*.68,m.accent,2);
  for(let i=0;i<3;i++){
   p(root+(i%2?-.27:.27),h*(.28+i*.16),.68,.22,m.accent,2);
   p(root+(i%2?-.52:.52),h*(.28+i*.16)+.16,.22,.5,m.accent,2);
  }
 }else if(theme==='urban'){
  // Civic bays: teal enamel dado, amber transom, broad mullions, one service
  // shutter per facade instead of a wall of identical luminous rectangles.
  p(0,h*.25,s,h*.22,ink,1);
  p(0,h*.77,s,.23,m.secondary,1);
  ribs(Math.min(4,Math.max(1,Math.floor(s/3.5))));
  grille((district-1)*s*.2,h*.49,Math.min(s*.34,2.4),h*.23,4);
  p(0,h-.62,s*.48,.09,m.glow,2);
 }else if(theme==='volcanic'){
  // Tall warm ceramic heat shields separated by steel channels. The paired
  // pipe chases and couplings are flattened relief, never protruding tubes.
  const n=Math.min(4,Math.max(1,Math.floor(s/2)));
  for(let i=0;i<n;i++){
   const u=-s/2+s*(i+.5)/n;
   p(u,h*.55,s/n-.22,h*.57,i%2?m.secondary:m.accent,1);
   p(u,h*.56,.12,h*.52,m.dark,2);
  }
  hazard(h*.16);
  for(const u of [-s*.33,s*.33]){
   p(u,h*.52,.16,h*.58,m.trim,2);
   for(const v of [.32,.68])p(u,h*v,.38,.17,m.dark,2);
  }
 }else if(theme==='snow'){
  // Clean naval cladding, widely spaced thermal joints and an asymmetric
  // double ice-blue stripe. No weathered industrial checkerboard here.
  p(0,h*.32,s,.52,m.accent,1);
  p(0,h*.32+.46,s,.15,m.secondary,1);
  ribs(Math.min(4,Math.max(1,Math.floor(s/4))),m.dark);
  p(s*.27,h*.68,Math.min(1.15,s*.18),h*.34,m.accent,1);
  grille(-s*.22,h*.65,Math.min(s*.3,2.1),h*.23,4);
 }else if(theme==='canyon'){
  // Dusty freight architecture: corrugated cargo fields, heavy corner straps,
  // and a shipping stencil plate that occupies a real section of wall.
  p(0,h*.53,s-.65,h*.65,district===2?m.accent:m.secondary,1);
  ribs(Math.min(8,Math.max(2,Math.floor(s/.9))),m.dark);
  p(0,h*.67,Math.min(s*.43,2.8),.65,m.skin,2);
  p(0,h*.67,Math.min(s*.3,1.8),.1,m.dark,2);
  hazard(.8);
 }else if(theme==='orbital'){
  // Segmented instrument cabinets, unequal service sectors and a technical
  // bus: long horizontal runs terminate inside each individual solid panel.
  const n=Math.min(4,Math.max(1,Math.floor(s/2.8)));
  for(let i=0;i<n;i++){
   const u=-s/2+s*(i+.5)/n,w=s/n-.24;
   p(u,h*.53,w,h*.62,m.dark,1);
   p(u,h*.55,w-.18,h*.51,i===district%n?m.secondary:m.skin,2);
   p(u,h*.73,w*.48,.12,m.accent,2);
  }
  p(0,h*.19,s-.5,.13,m.accent,1);
  p(s*.32,h*.25,.12,h*.2,m.glow,2);
  grille(-s*.25,h*.4,Math.min(s*.26,1.8),h*.18,3);
 }else if(theme==='forest-dam'){
  // Waterworks: concrete piers frame one large radiator/turbine service
  // cassette. Paired header pipes run only across its existing wall silhouette.
  p(0,h*.57,s*.8,h*.62,m.accent,1);
  grille(0,h*.54,s*.64,h*.43,Math.min(7,Math.max(3,Math.floor(s/1.1))),true);
  for(const v of [.24,.82]){
   p(0,h*v,s*.86,.2,m.secondary,2);
   for(const u of [-s*.32,s*.32])p(u,h*v,.22,.46,m.trim,2);
  }
  p(-s*.43,h/2,.2,h*.72,m.dark,2);
  p(s*.43,h/2,.2,h*.72,m.dark,2);
 }else{
  // Venue fascia and broad sector divisions stay on stands/service buildings.
  p(0,h*.52,s,h*.3,ink,1);
  ribs(Math.min(5,Math.max(1,Math.floor(s/8))));
  p(0,h*.73,s*.7,.12,m.glow,2);
 }
}

function floorPaint(arena,m,emit){
 if(!arena.terrain?.surfaces?.length||arena.race)return 0;
 const blocked=[...(arena.blocks??[])];
 // Reserve entire building interiors and a generous doorstep: markings belong
 // to the street, never the gap between two separate doorway wall blocks.
 for(const s of arena.structures??[]){
  if(['building','compound','causeway'].includes(s.type)&&finite(s.w)&&finite(s.d)){
   const c=Math.abs(Math.cos(s.rot??0)),sn=Math.abs(Math.sin(s.rot??0));
   blocked.push({x:s.x,z:s.z,w:c*s.w+sn*s.d,d:sn*s.w+c*s.d});
  }
  if(s.type==='causeway'&&s.accessPath?.length){
   const xs=s.accessPath.map(p=>p[0]),zs=s.accessPath.map(p=>p[2]);
   blocked.push({x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...zs)+Math.max(...zs))/2,
    w:Math.max(...xs)-Math.min(...xs)+s.d,d:Math.max(...zs)-Math.min(...zs)+s.d});
  }
 }
 for(const d of arena.destination?.serviceDecks??[])blocked.push({x:d.x,z:d.z,w:d.length+2*d.ramp,d:d.width});
 const routes=[...(arena.routes??arena.design?.routes??[]).map(r=>r.points),
  ...(arena.lanes??[]).filter(l=>l.kind==='vehicle-road').flatMap(l=>[l.waypoints,...(l.variants??[])])].filter(Boolean);
 const seen=new Set();let count=0,attempts=0;
 for(const route of routes)for(let i=1;i<route.length;i++){
  const [ax,az]=route[i-1],[bx,bz]=route[i],dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz);
  // The box callback is axis-aligned. Do not approximate bends with a jagged
  // necklace, or turn a diagonal freight road into misleading crosswalk bars.
  if(length<5||Math.min(Math.abs(dx),Math.abs(dz))>1e-6)continue;
  const alongX=Math.abs(dx)>Math.abs(dz);
  for(let distance=3;distance<length-2;distance+=7){
   if(count>=LIMITS.paint||attempts++>=640)return count;
   const x=ax+dx*distance/length,z=az+dz*distance/length,w=alongX?1.6:.16,d=alongX?.16:1.6;
   const key=`${x.toFixed(2)}:${z.toFixed(2)}`;
   if(seen.has(key))continue;seen.add(key);
   if(blocked.some(b=>overlap({x,z,w,d},b,1.4)))continue;
   // Exact triangle clipping catches holes and interior slope vertices which
   // a centre/corner height test would miss. Paint never spans a ramp or void.
   const support=terrainFootprintRange(arena.terrain,[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]]);
   if(!support||Math.abs(support.area-w*d)>1e-5||support.max-support.min>1e-5)continue;
   emit(w,.008,d,x,support.max+.006,z,m.secondary);count++;
  }
 }
 return count;
}

// The stock label canvas has a fixed 78 px font and clips long place names.
// Reuse its existing texture; two fitted lines need no extra mesh/material.
function fitSign(mesh,text,color){
 const texture=mesh?.material?.map,canvas=texture?.image,ctx=canvas?.getContext?.('2d');
 if(!ctx)return;
 let lines=[text];
 if(text.length>18){
  const words=text.split(/\s+/);let first=words.shift();
  while(words.length>1&&first.length+words[0].length<text.length/2)first+=` ${words.shift()}`;
  if(words.length)lines=[first,words.join(' ')];
 }
 const maxFont=lines.length>1?50:78;
 ctx.font=`bold ${maxFont}px monospace`;
 const width=Math.max(...lines.map(line=>ctx.measureText(line).width));
 const font=Math.min(maxFont,maxFont*(canvas.width-24)/Math.max(1,width));
 ctx.clearRect(0,0,canvas.width,canvas.height);ctx.font=`bold ${font}px monospace`;
 ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';
 lines.forEach((line,i)=>ctx.fillText(line,canvas.width/2,canvas.height/2+(i-(lines.length-1)/2)*54));
 texture.needsUpdate=true;
}

function facadeSigns(world,arena,faces,m,textLabel,emit,color){
 if(typeof textLabel!=='function')return 0;
 const used=new Set();let count=0;
 for(const landmark of arena.landmarks??[]){
  if(count>=LIMITS.labels)break;
  if(typeof landmark.label!=='string'||!landmark.label.trim()||![landmark.x,landmark.z].every(finite))continue;
  let best=null,bestDistance=Infinity;
  for(const f of faces){
   if(used.has(f.b)||f.span<3||f.height<3)continue;
   const dx=landmark.x-f.x,dz=landmark.z-f.z,outward=(f.alongX?dz:dx)*f.sign;
   if(outward<-.1)continue;
   const distance=Math.hypot(dx,dz);
   if(distance>26||distance>=bestDistance)continue;
   best=f;bestDistance=distance;
  }
  if(!best)continue;
  const f=best,size=Math.min(.72,(f.span-.6)/4),v=Math.min(f.height-.95,Math.max(2.1,f.height*.76));
  const p=facePainter(f,emit);
  p(0,v,size*4+.18,size+.16,m.dark,3);
  p(0,v-size*.62,size*4+.18,.08,m.accent,4);
  p(-size*2-.12,v,.08,size+.16,m.secondary,4);
  // textLabel returns a fixed PlaneGeometry (not a billboard). Match its +Z
  // normal to the chosen face, and keep its outer edge within 30 mm of solid.
  const nx=f.alongX?0:f.sign,nz=f.alongX?f.sign:0;
  const text=landmark.label.trim();
  const mesh=textLabel(world,text,f.x+nx*.03,f.base+v,f.z+nz*.03,size,color,Math.atan2(nx,nz));
  fitSign(mesh,text,color);
  used.add(f.b);count++;
 }
 return count;
}

export function destinationDetails(world,arena,{detail,material,textLabel,palette,trim,glow}){
 const theme=MAP_THEMES[arena.id]??arena.destination?.theme;
 if(arena.collection!=='destinations'||!THEMES[theme])return;
 const [skin,dark,accent,secondary,metal]=THEMES[theme];
 const m={skin:material(skin,metal,.78),dark:material(dark,metal,.72),
  accent:material(accent,metal,.62),secondary:material(secondary,metal,.75),trim,glow};
 palette.push(m.skin,m.dark,m.accent,m.secondary);
 const allFaces=facesOf(arena);
 // Even sampling and equal per-face budgets spread work across the whole map
 // if a later density pass adds more solids; a tail district cannot starve.
 const faces=allFaces.length<=LIMITS.faces?allFaces:Array.from({length:LIMITS.faces},(_,i)=>allFaces[Math.floor(i*allFaces.length/LIMITS.faces)]);
 const faceLimit=Math.min(40,Math.floor(LIMITS.facades/Math.max(1,faces.length)));
 let facadeBoxes=0;
 for(const f of faces){
  let local=0;
  dressFace(f,theme,m,(...args)=>{
   if(local>=faceLimit)return false;
   detail(...args);local++;facadeBoxes++;return true;
  });
 }
 const paintBoxes=floorPaint(arena,m,detail);
 let signBoxes=0;
 const labels=facadeSigns(world,arena,allFaces,m,textLabel,(...args)=>{detail(...args);signBoxes++;return true;},secondary);
 // Optional diagnostics for the integrating caller; no mutable map metadata.
 return {theme,facadeBoxes,paintBoxes,signBoxes,labels,boxes:facadeBoxes+paintBoxes+signBoxes,newMaterials:4};
}
