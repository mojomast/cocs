// CPU compatibility renderer for browsers with WebGL disabled. Consumes the exact
// Three.js scene and camera; gameplay is renderer-independent. Painter sorting is
// approximate at intersecting surfaces; WebGL remains the primary renderer.
import * as T from 'three';
export class SoftwareRenderer{
 constructor(canvas){this.domElement=canvas;this.ctx=canvas.getContext('2d',{alpha:false});if(!this.ctx)throw new Error('No canvas rendering context is available');this.info={render:{calls:0,triangles:0}};this.cache=new WeakMap();this.isSoftware=true;this.ratio=.85;}
 setPixelRatio(ratio){this.ratio=ratio;}
 setSize(w,h){this.domElement.width=Math.max(1,Math.round(w*this.ratio));this.domElement.height=Math.max(1,Math.round(h*this.ratio));}
 dispose(){}
 render(scene,camera){
  const ctx=this.ctx,w=this.domElement.width,h=this.domElement.height;ctx.fillStyle=scene.background?.getStyle()||'#080f13';ctx.fillRect(0,0,w,h);
  scene.updateMatrixWorld();camera.updateMatrixWorld();camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const f=h*.5/Math.tan(camera.fov*Math.PI/360),cx=w/2,cy=h/2,draw=[],viewMatrix=new T.Matrix4(),instanceMatrix=new T.Matrix4(),combined=new T.Matrix4();
  let triangles=0;
  const project=p=>[cx+p[0]*f/-p[2],cy-p[1]*f/-p[2]];
  const colors=new Map();const color=(mat,light,alpha)=>{let c=colors.get(mat);if(!c){c=mat.color.clone().convertLinearToSRGB();colors.set(mat,c);}return `rgba(${Math.min(255,Math.round(c.r*255*light))},${Math.min(255,Math.round(c.g*255*light))},${Math.min(255,Math.round(c.b*255*light))},${alpha})`;};
  const clip=verts=>{const out=[];for(let i=0;i<verts.length;i++){const a=verts[i],b=verts[(i+1)%verts.length],ain=a[2]<-.1,bin=b[2]<-.1;if(ain)out.push(a);if(ain!==bin){const t=(-.1-a[2])/(b[2]-a[2]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),-.1]);}}return out;};
  scene.traverseVisible(obj=>{
   if(!obj.geometry||!obj.material)return;const mat=Array.isArray(obj.material)?obj.material[0]:obj.material;if(!mat.visible||mat.opacity<.015)return;const pos=obj.geometry.attributes.position;if(!pos)return;
   viewMatrix.multiplyMatrices(camera.matrixWorldInverse,obj.matrixWorld);
   let cached=this.cache.get(obj.geometry);if(!cached){cached={positions:Array.from(pos.array),indices:obj.geometry.index?Array.from(obj.geometry.index.array):Array.from({length:pos.count},(_,i)=>i)};this.cache.set(obj.geometry,cached);}
   const instances=obj.isInstancedMesh?Math.max(0,obj.count|0):1,instanceArray=obj.isInstancedMesh?obj.instanceMatrix?.array:null;
   for(let instanceIndex=0;instanceIndex<instances;instanceIndex++){
    if(instanceArray&&instanceIndex*16+16<=instanceArray.length){instanceMatrix.fromArray(instanceArray,instanceIndex*16);combined.multiplyMatrices(viewMatrix,instanceMatrix);}else combined.copy(viewMatrix);
    const e=combined.elements,vertices=[];for(let i=0;i<cached.positions.length;i+=3){const x=cached.positions[i],y=cached.positions[i+1],z=cached.positions[i+2];vertices.push([e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]]);}
    if(obj.userData.label){const p=[e[12],e[13],e[14]];if(p[2]<-.1){draw.push({depth:-p[2],label:obj.userData.label,points:[project(p)],size:Math.max(5,obj.userData.labelSize*f/-p[2]),color:'#92d7cd'});}continue;}
    const ix=cached.indices;
    if(obj.isLine||obj.isLineSegments){for(let i=0;i<ix.length-1;i+=obj.isLineSegments?2:1){const a=vertices[ix[i]],b=vertices[ix[i+1]];if(a[2]>=-.1||b[2]>=-.1)continue;const p=project(a),q=project(b);if((p[0]<0&&q[0]<0)||(p[0]>w&&q[0]>w)||(p[1]<0&&q[1]<0)||(p[1]>h&&q[1]>h))continue;draw.push({depth:-(a[2]+b[2])*.5,points:[p,q],color:color(mat,1,mat.opacity),line:true});}continue;}
    if(!obj.isMesh)continue;
    for(let i=0;i<ix.length;i+=3){const a=vertices[ix[i]],b=vertices[ix[i+1]],c=vertices[ix[i+2]];if(!a||!b||!c||(a[2]>=-.1&&b[2]>=-.1&&c[2]>=-.1))continue;const poly=clip([a,b,c]);if(poly.length<3)continue;const p=poly.map(project),area=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]),back=mat.side===T.BackSide;if(((mat.side===T.FrontSide||back)&&(back?area<=0:area>=0))||Math.abs(area)<.06)continue;
     if(p.every(v=>v[0]<0)||p.every(v=>v[0]>w)||p.every(v=>v[1]<0)||p.every(v=>v[1]>h))continue;
     const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,nl=Math.hypot(nx,ny,nz)||1;
     const light=mat.isMeshBasicMaterial||mat.emissiveIntensity>0&&mat.emissive?.getHex()>0?1:Math.max(.4,.7+(nx*.25+ny*.7+nz*.55)/nl*.4);
     const depth=-(a[2]+b[2]+c[2])/3;draw.push({depth:obj.renderOrder===100?-100:depth,points:p,color:color(mat,light,mat.opacity),line:mat.wireframe,closed:true});triangles++;}
   }
  });
  draw.sort((a,b)=>b.depth-a.depth);ctx.lineWidth=.65;for(const d of draw){if(d.label){ctx.fillStyle=d.color;ctx.font=`bold ${d.size}px monospace`;ctx.textAlign='center';ctx.fillText(d.label,d.points[0][0],d.points[0][1]);continue;}ctx.beginPath();ctx.moveTo(d.points[0][0],d.points[0][1]);for(let i=1;i<d.points.length;i++)ctx.lineTo(d.points[i][0],d.points[i][1]);if(d.closed)ctx.closePath();if(d.line){ctx.strokeStyle=d.color;ctx.stroke();}else{ctx.fillStyle=d.color;ctx.fill();}}
  this.info.render.calls=draw.length;this.info.render.triangles=triangles;
 }
}
