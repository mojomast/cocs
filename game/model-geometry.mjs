// Procedural hard-surface vocabulary shared by operators and weapons. Geometry
// is allocated by the caller's ModelAssets/ctx.geo owner, never a global cache.
import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries,mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

export function beveledBox(width,height,depth,radius=Math.min(width,height,depth)*.18,segments=1){
 const source=new RoundedBoxGeometry(width,height,depth,segments,radius);
 // RoundedBox emits unindexed triangles. Weld equal position/normal/UV tuples
 // (not hard edges) so silhouettes receive the polygon budget, not duplicates.
 const result=mergeVertices(source);source.dispose();result.clearGroups();
 result.type='BeveledBoxGeometry';result.parameters={width,height,depth,radius,segments};return result;
}

// Y-axis contour with elliptical/squircle sections. Each section is
// [height, half-width, half-depth, forward-offset, lateral-offset, crown-rise].
// Optional crown-rise raises the sides of a section to form split crests.
// Repeated narrow sections
// form rolled plate edges instead of an inflated sphere or a stack of boxes.
export function contourGeometry(sections,{segments=24,power=.8}={}){
 const positions=[],uv=[],indices=[];
 for(let row=0;row<sections.length;row++){
   const [y,rx,rz,z=0,x=0,crown=0]=sections[row];
  for(let i=0;i<=segments;i++){
   const a=i/segments*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
    positions.push(Math.sign(c)*Math.abs(c)**power*rx+x,y+crown*c*c,Math.sign(s)*Math.abs(s)**power*rz+z);
   uv.push(i/segments,row/(sections.length-1));
  }
 }
 for(let row=0;row<sections.length-1;row++)for(let i=0;i<segments;i++){
  const a=row*(segments+1)+i,b=a+segments+1;
  indices.push(a,b,a+1,b,b+1,a+1);
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
 g.type='ContourGeometry';g.parameters={sections,segments,power};return g;
}

// Merge already transformed pieces of one material into one draw object.
// Input geometries are temporary and are always released, including on failure.
export function joinedGeometry(parts){
 try{return mergeGeometries(parts,false);}finally{for(const part of parts)part.dispose();}
}

export function placedGeometry(geometry,position=[0,0,0],rotation=[0,0,0]){
 const matrix=new T.Matrix4().compose(new T.Vector3(...position),new T.Quaternion().setFromEuler(new T.Euler(...rotation)),new T.Vector3(1,1,1));
 return geometry.applyMatrix4(matrix);
}

// Turned barrel, with a recessed inner wall and rolled muzzle/rear collars.
// Both ends remain open; unlike capped cylinders this has a real visible bore.
export function barrelGeometry(segments=24){
 return new T.LatheGeometry([[.78,-.5],[1,-.5],[1.07,-.46],[1.07,-.32],[1,-.28],[1,.40],[1.10,.44],[1.10,.5],[.78,.5],[.78,-.5]].map(p=>new T.Vector2(...p)),segments);
}

// Convex, authored XY armor outline. Rolled edges spend vertices on the rim,
// while planar faces stay a triangle fan (unlike subdividing an entire box).
// Outline is counterclockwise; all bevel rings stay INSIDE its exact envelope.
export function armorPanel(outline,depth,{bevel=.12,steps=2}={}){
 const positions=[],uv=[],indices=[],n=outline.length;
 const ring=(scale,z)=>{for(const [x,y] of outline){positions.push(x*scale,y*scale,z);uv.push(x+.5,y+.5);}};
 const rings=steps*2+2;
 for(let i=0;i<rings;i++){
  const t=i/(rings-1),a=t*Math.PI;
  ring(1-bevel+bevel*Math.sin(a),-Math.cos(a)*depth*.5);
 }
 for(let r=0;r<rings-1;r++)for(let i=0;i<n;i++){
  const a=r*n+i,b=r*n+(i+1)%n;indices.push(a,b,a+n,b,b+n,a+n);
 }
 // Duplicate the face vertices to retain a machined, planar normal at the rim.
 for(const [z,reverse] of [[-depth*.5,true],[depth*.5,false]]){
  const start=positions.length/3;ring(1-bevel,z);
  for(let i=1;i<n-1;i++)indices.push(start, start+(reverse?i+1:i), start+(reverse?i:i+1));
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
 g.type='ArmorPanelGeometry';g.parameters={outline,depth,bevel,steps};return g;
}
