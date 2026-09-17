import * as T from 'three';
import {withAssets,currentAssets,ModelAssets} from './effects-fx.mjs';
import {material,box,ring,textLabel,V} from './view.mjs';

// A truncated-icosahedron soccer ball: the Voronoi cells of an icosahedron's 12
// vertices are 12 pentagons and the cells of its 20 face centres are 20 hexagons,
// exactly the classic panel layout. We split a high-detail icosahedron's
// triangles into the two shells by nearest panel direction. Two meshes (not a
// multi-material group) so the CPU SoftwareRenderer, which reads only the first
// material and no vertex colours, still shows white and black panels.
function soccerBallPanels(radius,detail){
 const base=new T.IcosahedronGeometry(1,0),bp=base.attributes.position,pent=[],hex=[],seen=new Set();
 for(let i=0;i<bp.count;i+=3){
  const v=V(bp.getX(i),bp.getY(i),bp.getZ(i)).normalize(),key=`${v.x.toFixed(3)}|${v.y.toFixed(3)}|${v.z.toFixed(3)}`;
  if(!seen.has(key)){seen.add(key);pent.push(v);}
  hex.push(V((bp.getX(i)+bp.getX(i+1)+bp.getX(i+2))/3,(bp.getY(i)+bp.getY(i+1)+bp.getY(i+2))/3,(bp.getZ(i)+bp.getZ(i+1)+bp.getZ(i+2))/3).normalize());
 }
 base.dispose();
 const src=new T.IcosahedronGeometry(radius,detail),p=src.attributes.position,pentPos=[],hexPos=[];
 for(let i=0;i<p.count;i+=3){
  const c=V((p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3,(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3).normalize();
  let pentBest=-2,hexBest=-2;
  for(const d of pent)pentBest=Math.max(pentBest,c.dot(d));
  for(const d of hex)hexBest=Math.max(hexBest,c.dot(d));
  (pentBest>hexBest?pentPos:hexPos).push(p.getX(i),p.getY(i),p.getZ(i),p.getX(i+1),p.getY(i+1),p.getZ(i+1),p.getX(i+2),p.getY(i+2),p.getZ(i+2));
 }
 src.dispose();
 const build=array=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(array,3));g.computeVertexNormals();return g;};
 return {pent:build(pentPos),hex:build(hexPos)};
}

export function updateRace(view,match,time){
 view.raceModels??=new Map();const active=new Set(),reduced=view.reduced();
 const soccer=match.race?.kind==='soccer';
 if(soccer){
  const ball=match.race?.ball;
  if(ball&&Number.isFinite(ball.x)&&Number.isFinite(ball.z)){
   const key='soccer-ball',radius=Math.max(.2,Number.isFinite(ball.r)?ball.r:1.1);active.add(key);let model=view.raceModels.get(key);
   if(!model){model=new T.Group();model.name='soccer-ball';const assets=view.modelAssets??=new ModelAssets(),software=view.renderer?.isSoftware===true,panels=soccerBallPanels(radius,software?6:15);withAssets(assets,()=>{assets.register(panels.pent);assets.register(panels.hex);const white=material('#f3f6fa',.15,.5),black=material('#141922',.3,.6);model.add(new T.Mesh(panels.hex,white),new T.Mesh(panels.pent,black));});view._trackAssets?.(assets);model.userData.rollTime=time;model.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});view.worldGroup.add(model);view.raceModels.set(key,model);}
    model.position.set(ball.x,Number.isFinite(ball.y)?ball.y:radius,ball.z);
    // Roll without slipping about the horizontal axis perpendicular to travel.
    const lastRoll=model.userData.rollTime,dt=Number.isFinite(lastRoll)?Math.max(0,Math.min(.1,time-lastRoll)):0;model.userData.rollTime=time;
    const vx=Number(ball.vx)||0,vz=Number(ball.vz)||0,speed=Math.hypot(vx,vz);
    if(!reduced&&dt>0&&speed>1e-3)model.rotateOnWorldAxis(V(vz,0,-vx).normalize(),speed*dt/radius);
  }
 }
 if(!soccer)for(const entry of match.race?.boxes??[]){
  const key=`box:${entry.id}`;active.add(key);let model=view.raceModels.get(key);
  if(!model){model=new T.Group();box(model,1.7,1.7,1.7,0,0,0,material('#b28cff',.3,.4,true));if(typeof document!=='undefined')for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const face=new T.Group();face.rotation.y=yaw;textLabel(face,'?',0,0,.87,1.1,'#ffffff');model.add(face);}model.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});view.worldGroup.add(model);view.raceModels.set(key,model);}
  model.visible=entry.ready??entry.wait<=0;model.position.set(entry.x,2.2+(reduced?0:Math.sin(time*2)*.25),entry.z);model.rotation.y=reduced?0:time*.65;
 }
 if(!soccer)for(const entry of match.race?.hazards??[]){
  const kind=entry.type==='mine'?'mine':'oil',key=`${kind}:${entry.id}`;active.add(key);let model=view.raceModels.get(key);
  if(!model){model=new T.Group();
   if(kind==='mine'){const core=new T.Mesh(new T.IcosahedronGeometry(.55,1),material('#1b1d24',.7,.45));core.position.y=.55;model.add(core);for(let i=0;i<6;i++){const a=i*Math.PI/3,axis=V(Math.cos(a),0,Math.sin(a)),spike=new T.Mesh(new T.ConeGeometry(.09,.44,5),material('#3a3f4a',.6,.5));spike.position.set(axis.x*.52,.55,axis.z*.52);spike.quaternion.setFromUnitVectors(V(0,1,0),axis);model.add(spike);}const halo=new T.Mesh(new T.TorusGeometry(.72,.08,8,24),material('#ff4d4d',.3,.3,true));halo.rotation.x=Math.PI/2;halo.position.y=.06;model.add(halo);model.userData.ring=halo;}
   else{const slick=new T.Mesh(new T.CylinderGeometry(3.2,3.2,.035,24),material('#191322',.12,.6));model.add(slick);ring(model,3.2,.07,0,.03,0,material('#b28cff',.3,.4,true));}
   model.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});view.worldGroup.add(model);view.raceModels.set(key,model);}
  model.visible=entry.ttl>0;model.position.set(entry.x,kind==='mine'?0:.1,entry.z);
  if(kind==='mine'&&model.userData.ring)model.userData.ring.scale.setScalar(reduced?1:1+.14*Math.sin(time*6));
 }
 if(!soccer)for(const entry of match.race?.coins??[]){
  const key=`coin:${entry.id}`;active.add(key);let model=view.raceModels.get(key);
  if(!model){model=new T.Group();const disc=new T.Mesh(new T.CylinderGeometry(.42,.42,.09,20),material('#ffd35c',.85,.25,true));disc.rotation.z=Math.PI/2;model.add(disc);const rim=new T.Mesh(new T.TorusGeometry(.42,.05,8,24),material('#fff3b0',.7,.3,true));rim.rotation.y=Math.PI/2;model.add(rim);model.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});view.worldGroup.add(model);view.raceModels.set(key,model);}
  model.visible=entry.ready??entry.wait<=0;model.position.set(entry.x,1.2,entry.z);model.rotation.y=reduced?0:time*2.6;
 }
 for(const [key,model] of view.raceModels)if(!active.has(key)){view.worldGroup.remove(model);view.disposeObject(model);view.raceModels.delete(key);}
}
// Barrier polygons come from race.boundary (outer/inner loops) and fall back to
// offsetting the gate normals by halfWidth for older fixtures.
function raceBarrierPolygons(race){
 const boundary=race?.boundary;
 if(boundary&&Array.isArray(boundary.outer)&&boundary.outer.length>1){
  const polygons=[{points:boundary.outer,side:'outer'}];
  if(Array.isArray(boundary.inner)&&boundary.inner.length>1)polygons.push({points:boundary.inner,side:'inner'});
  return polygons;
 }
 const gates=Array.isArray(race?.gates)?race.gates:[];
 if(gates.length<2)return [];
 const halfWidth=Math.max(1,Number(gates[0].halfWidth)||12);
 const offset=sign=>gates.map(p=>({x:p.x-p.nz*sign*halfWidth,z:p.z+p.nx*sign*halfWidth}));
 return [{points:offset(-1),side:'outer'},{points:offset(1),side:'inner'}];
}
// One merged wall per polygon: vertical quads along every edge plus a top cap,
// with a separate thin stripe band floated 0.03 off the wall plane. Vertices
// carry world-unit UVs (0.1 per metre) so the caution-stripe bake can wrap the
// barrier without an authored UV layer.
function raceBarrierGeometry(points,side,height=2.7){
 const positions=[],wallUvs=[],stripes=[],stripeUvs=[];
 const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+(p.x*q.z-q.x*p.z);},0);
 const ccw=area>=0,capWidth=.34,stripeOffset=.03,stripeTop=height-.1,stripeBottom=height-.42,scale=.1;
 let run=0;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
  if(!(length>1e-6))continue;
  let nx=-dz/length,nz=dx/length;
  if(!ccw){nx=-nx;nz=-nz;}
  const facing=side==='inner'?-1:1,tx=nx*facing,tz=nz*facing;
  const u0=run*scale,u1=(run+length)*scale,vTop=height*scale,vStripeTop=stripeTop*scale,vStripeBottom=stripeBottom*scale;
  positions.push(a.x,0,a.z,b.x,0,b.z,b.x,height,b.z,a.x,0,a.z,b.x,height,b.z,a.x,height,a.z);
  wallUvs.push(u0,0,u1,0,u1,vTop,u0,0,u1,vTop,u0,vTop);
  const cx0=a.x+tx*capWidth,cz0=a.z+tz*capWidth,cx1=b.x+tx*capWidth,cz1=b.z+tz*capWidth;
  positions.push(a.x,height,a.z,b.x,height,b.z,cx1,height,cz1,a.x,height,a.z,cx1,height,cz1,cx0,height,cz0);
  wallUvs.push(u0,vTop,u1,vTop,u1,vTop,u0,vTop,u1,vTop,u0,vTop);
  stripes.push(a.x+tx*stripeOffset,stripeBottom,a.z+tz*stripeOffset,b.x+tx*stripeOffset,stripeBottom,b.z+tz*stripeOffset,b.x+tx*stripeOffset,stripeTop,b.z+tz*stripeOffset,a.x+tx*stripeOffset,stripeBottom,a.z+tz*stripeOffset,b.x+tx*stripeOffset,stripeTop,b.z+tz*stripeOffset,a.x+tx*stripeOffset,stripeTop,a.z+tz*stripeOffset);
  stripeUvs.push(u0,vStripeBottom,u1,vStripeBottom,u1,vStripeTop,u0,vStripeBottom,u1,vStripeTop,u0,vStripeTop);
  run+=length;
 }
 const wall=new T.BufferGeometry();wall.setAttribute('position',new T.Float32BufferAttribute(positions,3));wall.setAttribute('uv',new T.Float32BufferAttribute(wallUvs,2));wall.computeVertexNormals();
 const stripe=new T.BufferGeometry();stripe.setAttribute('position',new T.Float32BufferAttribute(stripes,3));stripe.setAttribute('uv',new T.Float32BufferAttribute(stripeUvs,2));stripe.computeVertexNormals();
 return {wall,stripe};
}
// Nearest-centerline tangent for a boost pad, so the chevrons point along the
// local racing direction rather than a fixed world axis.
function centerlineDirection(x,z,points){
 if(!points?.length)return {x:0,z:1};
 let best=null,bestDist=Infinity;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
  if(!(length2>1e-9))continue;
  const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/length2)),px=a.x+dx*t,pz=a.z+dz*t,dist=(x-px)**2+(z-pz)**2;
  if(dist<bestDist){bestDist=dist;best={x:dx,z:dz};}
 }
 if(!best)return {x:0,z:1};
 const length=Math.hypot(best.x,best.z)||1;
 return {x:best.x/length,z:best.z/length};
}
// A flat V-chevron laid on the track; +Y in shape space becomes +Z once the
// mesh is tilted flat, which matches the group yaw convention used below.
function boostChevronGeometry(width=.72,height=.6,thickness=.24){
 const shape=new T.Shape();
 shape.moveTo(0,0);shape.lineTo(width,-height);shape.lineTo(width,-height+thickness);
 shape.lineTo(0,thickness);shape.lineTo(-width,-height+thickness);shape.lineTo(-width,-height);
 shape.closePath();
 return new T.ShapeGeometry(shape);
}
// One pad group per boost pad, drawn flat at y=.06 so it can never z-fight the
// floor. Three chevrons keep the direction legible at race speed.
function boostPadModel(pad,centerline){
 const group=new T.Group(),dir=centerlineDirection(pad.x,pad.z,centerline);
 group.position.set(pad.x,.06,pad.z);group.rotation.y=Math.atan2(dir.x,dir.z);group.userData.raceBoost=pad.id;
 const geometry=boostChevronGeometry(),glow=new T.MeshBasicMaterial({color:'#a8f7ff',transparent:true,opacity:.92,side:T.DoubleSide,depthWrite:false});
 for(let i=0;i<3;i++){const chevron=new T.Mesh(geometry,glow);chevron.rotation.x=Math.PI/2;chevron.position.z=(i-1)*.66;group.add(chevron);}
 return group;
}
// Thin lattice for the goal nets: a grid of line segments on the back, both
// sides and the roof of the goal box. LineSegments keep the CPU renderer cheap
// (it draws lines directly) while reading as a mesh net instead of solid slabs.
function netLatticeGeometry({halfWidth=6,height=4,depth=2,cell=.6}={}){
 const nx=Math.max(2,Math.round(halfWidth*2/Math.max(.25,cell))),ny=Math.max(2,Math.round(height/Math.max(.25,cell))),nz=Math.max(1,Math.round(depth/Math.max(.25,cell))),positions=[];
 const segment=(x1,y1,z1,x2,y2,z2)=>positions.push(x1,y1,z1,x2,y2,z2);
 for(let i=0;i<=nx;i++){const x=-halfWidth+2*halfWidth*i/nx;segment(x,0,depth,x,height,depth);}
 for(let j=0;j<=ny;j++){const y=height*j/ny;segment(-halfWidth,y,depth,halfWidth,y,depth);}
 for(const side of [-1,1]){
  for(let j=0;j<=ny;j++){const y=height*j/ny;segment(side*halfWidth,y,0,side*halfWidth,y,depth);}
  for(let k=0;k<=nz;k++){const z=depth*k/nz;segment(side*halfWidth,0,z,side*halfWidth,height,z);}
 }
 for(let i=0;i<=nx;i++){const x=-halfWidth+2*halfWidth*i/nx;segment(x,height,0,x,height,depth);}
 for(let k=0;k<=nz;k++){const z=depth*k/nz;segment(-halfWidth,height,z,halfWidth,height,z);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 return geometry;
}
// Soccer reuses the same flat-shell treatment: mown stripes and paint sit under
// the play area, while the goal frames stay real occluders for the chase camera.
function soccerPitchBody(parent,race,options={}){
 const netDetail=Math.max(.3,Math.min(1,Number(options?.quality?.scatterDetail??1))),netCell=netDetail>=.8?.6:netDetail>=.5?.78:1;
 const pitch=race.pitch||{},minX=Number.isFinite(pitch.minX)?pitch.minX:-30,maxX=Number.isFinite(pitch.maxX)?pitch.maxX:30,minZ=Number.isFinite(pitch.minZ)?pitch.minZ:-18,maxZ=Number.isFinite(pitch.maxZ)?pitch.maxZ:18;
 const width=maxX-minX,depth=maxZ-minZ,cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;
 // The view hands us its textured-surface helper; without it (tests, the CPU
 // renderer) the flat authored materials are used unchanged.
 const surface=typeof options?.surface==='function'?options.surface:null;
 const grass=surface?surface(material('#2c7038',.02,.96),'grass',3,3):material('#2c7038',.02,.96),mown=surface?surface(material('#337d40',.02,.96),'grass',3,3):material('#337d40',.02,.96),line=material('#eaf7ee',.05,.85),postMat=surface?surface(material('#eef2f6',.35,.4),'brushed_metal',2,1):material('#eef2f6',.35,.4),netMat=new T.LineBasicMaterial({color:'#bfe0c8',transparent:true,opacity:.5});
 const paint=(w,h,d,x,y,z,mat)=>{const mesh=box(parent,w,h,d,x,y,z,mat);mesh.userData.arenaDetail=true;return mesh;};
 // Flat paint arcs: a RingGeometry slice laid on the turf. Local +X/+Y maps to
 // world +X/-Z once rotated flat, so callers pass angles in that frame.
 const arc=(radius,thickness,thetaStart,thetaLength,x,z)=>{
  const mesh=new T.Mesh(new T.RingGeometry(Math.max(.01,radius-thickness),radius+thickness,Math.max(10,Math.round(radius*5)),1,thetaStart,thetaLength),line);
  mesh.rotation.x=-Math.PI/2;mesh.position.set(x,.06,z);mesh.userData.arenaDetail=true;mesh.userData.pitchArc=true;parent.add(mesh);return mesh;
 };
 const stripes=8,stripeWidth=width/stripes;
 for(let i=0;i<stripes;i++)paint(stripeWidth,.05,depth,minX+stripeWidth*(i+.5),.03,cz,i%2?mown:grass);
 paint(width+.3,.06,.18,cx,.05,minZ,line);paint(width+.3,.06,.18,cx,.05,maxZ,line);
 paint(.18,.06,depth+.3,minX,.05,cz,line);paint(.18,.06,depth+.3,maxX,.05,cz,line);
 paint(.18,.06,depth,cx,.05,cz,line);
 const circle=ring(parent,Math.min(width,depth)*.16,.08,cx,.06,cz,line);circle.userData.arenaDetail=true;
 const spot=new T.Mesh(new T.CylinderGeometry(.35,.35,.05,16),line);spot.position.set(cx,.06,cz);spot.userData.arenaDetail=true;parent.add(spot);
 const centre=ring(parent,1.5,.045,cx,.07,cz,line);centre.userData.arenaDetail=true;
 // Corner arcs: quarter circles opening toward the pitch interior.
 const cornerRadius=Math.min(2.4,Math.max(1.1,Math.min(width,depth)*.06));
 for(const [x,z,thetaStart] of [[minX,minZ,-Math.PI/2],[maxX,minZ,Math.PI],[minX,maxZ,0],[maxX,maxZ,Math.PI/2]])arc(cornerRadius,.09,thetaStart,Math.PI/2,x,z);
 for(const goal of race.goals||[]){
  const halfWidth=Math.max(1,Number(goal.halfWidth)||6),height=Math.max(1,Number(goal.height)||4),goalDepth=Math.max(.4,Number(goal.depth)||2),goalZ=Number.isFinite(goal.z)?goal.z:cz;
  const dir=Math.sign(goal.nx)||(goal.x<=cx?-1:1),boxDepth=Math.max(6,halfWidth*1.4),innerX=goal.x-dir*boxDepth,field=Math.sign(-dir)||1,midAngle=field>=0?0:Math.PI,halfArc=Math.PI/2;
  paint(boxDepth,.06,.16,(goal.x+innerX)/2,.05,goalZ+halfWidth,line);
  paint(boxDepth,.06,.16,(goal.x+innerX)/2,.05,goalZ-halfWidth,line);
  paint(.16,.06,halfWidth*2,innerX,.05,goalZ,line);
  // Goal-area arc bulges into the field off the small box; the penalty arc sits
  // further out around the penalty spot with a narrower sweep.
  arc(halfWidth*.6,.1,midAngle-halfArc,Math.PI,innerX,goalZ);
  const penaltyX=goal.x-dir*(boxDepth+halfWidth*.4);
  arc(halfWidth*1.15,.1,midAngle-halfArc,Math.PI*.82,penaltyX,goalZ);
  const penaltySpot=new T.Mesh(new T.CylinderGeometry(.22,.22,.05,14),line);penaltySpot.position.set(penaltyX,.06,goalZ);penaltySpot.userData.arenaDetail=true;parent.add(penaltySpot);
  const frame=new T.Group();frame.position.set(goal.x,0,goalZ);frame.rotation.y=Math.atan2(goal.nx,goal.nz);
  for(const x of [-halfWidth,halfWidth])box(frame,.2,height,.2,x,height/2,0,postMat).userData.soccerPost=true;
  box(frame,halfWidth*2,.2,.2,0,height,0,postMat).userData.soccerPost=true;
  const net=new T.LineSegments(netLatticeGeometry({halfWidth,height,depth:goalDepth,cell:netCell}),netMat);
  net.userData.soccerNet=true;net.userData.arenaDetail=true;net.userData.noCameraOcclusion=true;
  frame.add(net);
  parent.add(frame);
 }
}
export function raceTrackModel(race,color='#83f4d5',parent,assets,options){const cache=assets??currentAssets()??new ModelAssets();return withAssets(cache,()=>raceTrackBody(race,color,parent,options));}
function raceTrackBody(race,color='#83f4d5',parent,options){
 const group=new T.Group(),white=material('#ffffff'),black=material('#10151b'),accent=material(color,.4,.3,true);
 if(race.kind==='soccer')soccerPitchBody(group,race,options);else{
  const gates=race.gates??[],start=gates[0];
  if(start){const line=new T.Group();line.position.set(start.x,.08,start.z);line.rotation.y=Math.atan2(start.nx,start.nz);for(let row=0;row<2;row++)for(let col=0;col<12;col++)box(line,2,.025,1.2,(col-5.5)*2,0,(row-.5)*1.2,(row+col)%2?white:black);group.add(line);}
  for(const [index,p] of (race.grid??[]).entries()){const slot=new T.Group();slot.position.set(p.x,.08,p.z);slot.rotation.y=p.heading??p.yaw??0;slot.userData.raceGrid=index;for(const x of [-2,2])box(slot,.12,.03,5,x,0,0,white);for(const z of [-2.5,2.5])box(slot,4,.03,.12,0,0,z,white);group.add(slot);}
  for(const [index,gate] of gates.entries()){const frame=new T.Group(),width=gate.halfWidth??12,mat=index===0?accent:material(index%2?'#ffce73':'#b28cff',.4,.3,true);frame.position.set(gate.x,0,gate.z);frame.rotation.y=Math.atan2(gate.nx,gate.nz);frame.userData.raceGate=index;for(const x of [-width,width])box(frame,.25,6,.25,x,3,0,mat);box(frame,width*2,.25,.25,0,6,0,mat);if(typeof document!=='undefined'){textLabel(frame,index===0?'1 / FINISH':String(index+1),0,6.8,0,1.4,'#ffffff');textLabel(frame,String(index+1),0,6.8,0,1.4,'#ffffff',Math.PI);}group.add(frame);}
  const points=race.centerline??[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(!length)continue;const stripe=box(group,.16,.025,length,(a.x+b.x)/2,.07,(a.z+b.z)/2,accent);stripe.rotation.y=Math.atan2(dx,dz);}
  for(const pad of race.boostPads??[])group.add(boostPadModel(pad,points));
 }
 const host=parent||group,polygons=raceBarrierPolygons(race);
 if(polygons.length){
  const surface=typeof options?.surface==='function'?options.surface:null,barrierMat=surface?surface(material('#e78b30',.08,.78),'hazard_stripes',1,1):material('#e78b30',.08,.78),stripeMat=material('#f4eddb',.05,.85);
  if(barrierMat.side!==T.DoubleSide)barrierMat.side=T.DoubleSide;
  if(stripeMat.side!==T.DoubleSide)stripeMat.side=T.DoubleSide;
  for(const {points,side} of polygons){
   if(!(points.length>1))continue;
   const {wall,stripe}=raceBarrierGeometry(points,side);
   const wallMesh=new T.Mesh(wall,barrierMat);wallMesh.userData.raceBarrier=side;host.add(wallMesh);
   const stripeMesh=new T.Mesh(stripe,stripeMat);stripeMesh.userData.raceStripe=true;stripeMesh.userData.arenaDetail=true;host.add(stripeMesh);
  }
 }
 if(parent&&group.parent!==parent)parent.add(group);
 // Markers are visual only and must not shorten the camera's occlusion ray; the
 // solid rail walls stay occluders so the camera can pull in front of them.
 group.traverse(n=>{if(n.userData.raceBarrier||n.userData.soccerPost)return;n.userData.objective=true;n.userData.noCameraOcclusion=true;});
 if(host!==group)for(const n of host.children)if(n.userData.raceStripe){n.userData.objective=true;n.userData.noCameraOcclusion=true;}
 return group;
}
