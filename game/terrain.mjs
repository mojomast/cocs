const EPSILON=1e-9;
const triangleCache=new WeakMap(),wallTriangleCache=new WeakMap(),wallSegmentCache=new WeakMap();

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const point=(value,label)=>{
  const p=Array.isArray(value)?value:[value?.x,value?.y,value?.z];
  if(!Array.isArray(p)||p.length<3||!p.slice(0,3).every(finite))throw new TypeError(`Invalid ${label}`);
  return [p[0],p[1],p[2]];
};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const subtract=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const normalOf=(a,b,c)=>{
  const n=cross(subtract(b,a),subtract(c,a)), length=Math.hypot(...n);
  if(length<=EPSILON)throw new RangeError('Degenerate terrain triangle');
  return n.map(value=>value/length);
};
const list=(value,label)=>{
  if(!Array.isArray(value))throw new TypeError(`Invalid ${label}`);
  return value;
};
const surfacesOf=terrain=>{
  if(!terrain||typeof terrain!=='object')throw new TypeError('Invalid terrain');
  return list(terrain.surfaces??[],'surfaces');
};

function surfaceTriangles(surface,surfaceId){
  if(!surface||typeof surface!=='object')throw new TypeError('Invalid surface');
  const vertices=list(surface.vertices,`vertices for surface ${surfaceId}`).map((v,i)=>point(v,`vertex ${i}`));
  if(vertices.length<3)throw new RangeError(`Surface ${surfaceId} needs three vertices`);
  const indices=surface.triangles===undefined
    ? Array.from({length:vertices.length-2},(_,i)=>[0,i+1,i+2])
    : list(surface.triangles,`triangles for surface ${surfaceId}`);
  return indices.map((triangle,triangleId)=>{
    if(!Array.isArray(triangle)||triangle.length!==3||!triangle.every(i=>Number.isInteger(i)&&i>=0&&i<vertices.length))throw new TypeError(`Invalid triangle ${surfaceId}:${triangleId}`);
    const triangleVertices=triangle.map(i=>vertices[i].slice());
     return {surfaceId:surface.id??surfaceId,material:surface.material,walkable:surface.walkable!==false,indices:triangle.slice(),vertices:triangleVertices,normal:normalOf(...triangleVertices)};
  });
}

const wallVertices=(wall,wallId)=>{
  if(Array.isArray(wall))return wall.map((v,i)=>point(v,`wall ${wallId} vertex ${i}`));
  if(!wall||typeof wall!=='object')throw new TypeError(`Invalid wall ${wallId}`);
  if(wall.vertices!==undefined)return list(wall.vertices,`wall ${wallId} vertices`).map((v,i)=>point(v,`wall ${wallId} vertex ${i}`));
  if(wall.a!==undefined&&wall.b!==undefined)return [point(wall.a,`wall ${wallId} a`),point(wall.b,`wall ${wallId} b`)];
  if(wall.from!==undefined&&wall.to!==undefined)return [point(wall.from,`wall ${wallId} from`),point(wall.to,`wall ${wallId} to`)];
  throw new TypeError(`Invalid wall ${wallId}`);
};
const wallTriangles=terrain=>list(terrain.walls??[],'walls').flatMap((wall,wallId)=>{
  const vertices=wallVertices(wall,wallId);
  if(vertices.length<2)throw new RangeError(`Wall ${wallId} needs two vertices`);
  if(vertices.length===2){
    if(Math.hypot(...subtract(vertices[1],vertices[0]))<=EPSILON)throw new RangeError(`Degenerate wall ${wallId}`);
    return [];
  }
  return Array.from({length:vertices.length-2},(_,i)=>{
    const v=[vertices[0].slice(),vertices[i+1].slice(),vertices[i+2].slice()];
     return {surfaceId:null,material:wall.material,walkable:false,indices:[0,i+1,i+2],vertices:v,normal:normalOf(...v)};
  });
});

export function terrainTriangles(terrain){
  if(triangleCache.has(terrain))return triangleCache.get(terrain);
  const triangles=surfacesOf(terrain).flatMap((surface,id)=>surfaceTriangles(surface,id));
  triangleCache.set(terrain,triangles);
  return triangles;
}

export function terrainWallTriangles(terrain){
  if(wallTriangleCache.has(terrain))return wallTriangleCache.get(terrain);
  const triangles=wallTriangles(terrain);
  wallTriangleCache.set(terrain,triangles);
  return triangles;
}

export function terrainWallSegments(terrain){
  if(wallSegmentCache.has(terrain))return wallSegmentCache.get(terrain);
  const segments=list(terrain?.walls??[],'walls').flatMap((wall,wallId)=>{
    const vertices=wallVertices(wall,wallId),closed=vertices.length>2,limit=closed?vertices.length:vertices.length-1;
    return Array.from({length:limit},(_,index)=>{
      const a=vertices[index],b=vertices[(index+1)%vertices.length];
      if(Math.hypot(b[0]-a[0],b[2]-a[2])<=EPSILON)return null;
      return {wallId,a:{x:a[0],y:a[1],z:a[2]},b:{x:b[0],y:b[1],z:b[2]}};
    }).filter(Boolean);
  });
  wallSegmentCache.set(terrain,segments);
  return segments;
}

export function terrainSupportAt(x,z,terrain,maxSlope=Infinity){
  if(!finite(x)||!finite(z)||(!finite(maxSlope)&&maxSlope!==Infinity)||maxSlope<0)throw new TypeError('Invalid support query');
  let best=null;
  for(const triangle of terrainTriangles(terrain)){
    const [a,b,c]=triangle.vertices, denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    if(Math.abs(denominator)<=EPSILON)continue;
    const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/denominator;
    const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/denominator;
    const w=1-u-v;
     if(u<-EPSILON||v<-EPSILON||w<-EPSILON||triangle.normal[1]<=EPSILON||triangle.walkable===false)continue;
    if(triangle.normal[1]<Math.cos(maxSlope)-EPSILON)continue;
    const y=u*a[1]+v*b[1]+w*c[1];
    if(!best||y>best.y+EPSILON)best={y,normal:triangle.normal.slice(),surfaceId:triangle.surfaceId,material:triangle.material};
  }
  return best;
}

// Convex footprint clipping in XZ, retaining interpolated Y. Footprints are
// counter-clockwise in XZ; input triangles retain their original winding.
function clipHalf(poly,a,b,inside=true) {
  if(!poly.length)return [];
  const distance=p=>((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]))*(inside?1:-1);
  const out=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],dp=distance(p),dq=distance(q);
    if(dp>=-EPSILON)out.push(p);
    if((dp>EPSILON&&dq<-EPSILON)||(dp<-EPSILON&&dq>EPSILON)){
      const t=dp/(dp-dq);out.push(p.map((v,k)=>v+(q[k]-v)*t));
    }
  }
  return out;
}
function footprintPolygon(poly) {
  if(!Array.isArray(poly)||poly.length<3||!poly.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite)))throw new TypeError('Invalid footprint');
  let area=0;
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];area+=a[0]*b[1]-b[0]*a[1];}
  const result=area<0?poly.slice().reverse():poly;
  if(Math.abs(area)<=EPSILON)throw new RangeError('Degenerate footprint');
  for(let i=0;i<result.length;i++){
    const a=result[i],b=result[(i+1)%result.length],c=result[(i+2)%result.length];
    if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<-EPSILON)throw new RangeError('Footprint must be convex');
  }
  return result;
}
const projectedArea=poly=>Math.abs(poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p[0]*q[2]-q[0]*p[2];},0))/2;
const clipFootprint=(vertices,poly)=>poly.reduce((v,a,i)=>clipHalf(v,a,poly[(i+1)%poly.length]),vertices);

// Exact extrema of the intersected piecewise-linear terrain, not centre/corner
// sampling: an interior terrain vertex can be the highest point of a foundation.
export function terrainFootprintRange(terrain,footprint) {
  const poly=footprintPolygon(footprint);let min=Infinity,max=-Infinity,area=0;
  for(const t of terrainTriangles(terrain)){
    if(!t.walkable||t.normal[1]<=EPSILON)continue;
    const clipped=clipFootprint(t.vertices,poly),a=projectedArea(clipped);
    if(a<=EPSILON)continue;
    area+=a;for(const p of clipped){min=Math.min(min,p[1]);max=Math.max(max,p[1]);}
  }
  return area>EPSILON?{min,max,area}:null;
}

// Author a ground replacement, NOT an elevated platform. Remove old terrain
// under the footprint (including cliff proxies), then emit the same triangle
// schema consumed by render, collision/rays and nav. Call only during generation.
// The callback must describe a plane; piecewise paths stamp one segment at a time.
export function stampTerrainFloor(terrain,footprint,height,id='authored-floor',{skirts=false}={}) {
  const poly=footprintPolygon(footprint),surfaces=[];
  const authored={id,material:'stone',walkable:true,vertices:[],triangles:[]};
  const skirt={id:`${id}-sides`,material:'stone',walkable:false,vertices:[],triangles:[]};
  const emit=(target,vertices)=>{
    for(let i=1;i<vertices.length-1;i++){
      const tri=[vertices[0],vertices[i],vertices[i+1]];
      if(Math.hypot(...cross(subtract(tri[1],tri[0]),subtract(tri[2],tri[0])))<=EPSILON)continue;
      const base=target.vertices.length;target.vertices.push(...tri);target.triangles.push([base,base+1,base+2]);
    }
  };
  for(const surface of surfacesOf(terrain)){
    const out={...surface,vertices:[],triangles:[]};
    for(const t of surfaceTriangles(surface,surface.id)){
      const clipped=clipFootprint(t.vertices,poly);
      if(!clipped.length || (t.walkable&&projectedArea(clipped)<=EPSILON)){emit(out,t.vertices);continue;}
      let remainder=t.vertices;
      for(let i=0;i<poly.length;i++){
        emit(out,clipHalf(remainder,poly[i],poly[(i+1)%poly.length],false));
        remainder=clipHalf(remainder,poly[i],poly[(i+1)%poly.length]);
      }
      if(t.walkable&&t.normal[1]>EPSILON){
        const raised=clipped.map(p=>{
          const y=height(p[0],p[2]);if(!finite(y))throw new TypeError('Invalid authored floor height');return [p[0],y,p[2]];
        });
        emit(authored,raised);
        // Only the edit perimeter needs a retaining face. Preserve every old
        // triangle intersection there, so skirts meet the actual ground, not
        // a centre/corner approximation. Ordinary foundation/tunnel stamps
        // keep their existing behavior unless explicitly opted in.
        if(skirts)for(let j=0;j<clipped.length;j++){
          const k=(j+1)%clipped.length,p=clipped[j],q=clipped[k];
          if(poly.some((a,i)=>{
            const b=poly[(i+1)%poly.length],edge=v=>(b[0]-a[0])*(v[2]-a[1])-(b[1]-a[1])*(v[0]-a[0]);
            return Math.abs(edge(p))<1e-7&&Math.abs(edge(q))<1e-7;
          }))emit(skirt,[p,q,raised[k],raised[j]]);
        }
      }
    }
    if(out.triangles.length)surfaces.push(out);
  }
  // Split existing cliff wall segments at the same boundary, never leave an
  // invisible old wall across a newly authored doorway or tunnel floor.
  const walls=[];
  for(const [wallId,wall] of (terrain.walls??[]).entries()){
    const vertices=wallVertices(wall,wallId);
    if(vertices.length>2){
      // Retain actual polygons: converting them to two-point movement proxies
      // would silently remove ray collision from untouched portions of the wall.
      const out={vertices:[],triangles:[]};
      for(let j=1;j<vertices.length-1;j++){
        let remainder=[vertices[0],vertices[j],vertices[j+1]];
        if(!clipFootprint(remainder,poly).length){emit(out,remainder);continue;}
        for(let i=0;i<poly.length;i++){
          emit(out,clipHalf(remainder,poly[i],poly[(i+1)%poly.length],false));
          remainder=clipHalf(remainder,poly[i],poly[(i+1)%poly.length]);
        }
      }
      for(const tri of out.triangles)walls.push({material:wall.material,vertices:tri.map(i=>out.vertices[i])});
      continue;
    }
    const [pa,pb]=vertices,a={x:pa[0],y:pa[1],z:pa[2]},b={x:pb[0],y:pb[1],z:pb[2]};
    let lo=0,hi=1;
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],dist=v=>(q[0]-p[0])*(v.z-p[1])-(q[1]-p[1])*(v.x-p[0]);
      const da=dist(a),db=dist(b),delta=db-da;
      if(Math.abs(delta)<=EPSILON){if(da<-EPSILON){lo=1;hi=0;break;}}
      else if(delta>0)lo=Math.max(lo,-da/delta);else hi=Math.min(hi,-da/delta);
    }
    const at=t=>[a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t];
    if(lo>=hi){walls.push({a:at(0),b:at(1)});continue;}
    if(lo>EPSILON)walls.push({a:at(0),b:at(lo)});
    if(hi<1-EPSILON)walls.push({a:at(hi),b:at(1)});
  }
  for(const addition of [authored,skirt])if(addition.triangles.length){
    const batch=surfaces.find(s=>s.id===addition.id&&s.material===addition.material&&(s.walkable!==false)===addition.walkable);
    if(batch){const base=batch.vertices.length;batch.vertices.push(...addition.vertices);batch.triangles.push(...addition.triangles.map(t=>t.map(i=>i+base)));}
    else surfaces.push(addition);
  }
  terrain.surfaces=surfaces;terrain.walls=walls;
  triangleCache.delete(terrain);wallTriangleCache.delete(terrain);wallSegmentCache.delete(terrain);
  terrain.height=(x,z)=>terrainSupportAt(x,z,terrain)?.y??null;
  return authored;
}

function rayTriangle(origin,direction,triangle){
  const [a,b,c]=triangle.vertices, edge1=subtract(b,a),edge2=subtract(c,a),h=cross(direction,edge2),det=dot(edge1,h);
  if(Math.abs(det)<=EPSILON)return null;
  const inverse=1/det,s= subtract(origin,a),u=inverse*dot(s,h);
  if(u<-EPSILON||u>1+EPSILON)return null;
  const q=cross(s,edge1),v=inverse*dot(direction,q);
  if(v<-EPSILON||u+v>1+EPSILON)return null;
  const distance=inverse*dot(edge2,q);
  return distance>=-EPSILON?Math.max(0,distance):null;
}

export function terrainRayHit(origin,direction,max=Infinity,terrain){
  const o=point(origin,'ray origin'),d=point(direction,'ray direction');
  if((!finite(max)&&max!==Infinity)||max<0||Math.hypot(...d)<=EPSILON)throw new TypeError('Invalid ray query');
  let hit=null;
  for(const triangle of [...terrainTriangles(terrain),...wallTriangles(terrain)]){
    const distance=rayTriangle(o,d,triangle);
    if(distance!==null&&distance<=max+EPSILON&&(!hit||distance<hit.distance-EPSILON))hit={distance,normal:triangle.normal.slice(),surfaceId:triangle.surfaceId,material:triangle.material};
  }
  return hit;
}

export function terrainBounds(terrain){
  const points=[];
  for(const surface of surfacesOf(terrain)){
    if(!surface||typeof surface!=='object')throw new TypeError('Invalid surface');
    points.push(...list(surface.vertices,'surface vertices').map(v=>point(v,'surface vertex')));
  }
  for(const wall of list(terrain.walls??[],'walls'))points.push(...wallVertices(wall,points.length));
  if(!points.length)return null;
  return {minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1])),minZ:Math.min(...points.map(p=>p[2])),maxZ:Math.max(...points.map(p=>p[2]))};
}
