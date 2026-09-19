import * as T from 'three';
// Foundry-only art pass. All architecture is the map's authoritative blocks and
// terrain; these shallow details never create an apparent door across a solid.
// Uses the arena's existing static detail batches (not a draw call per rivet).
export function foundryDetails(world,arena,{detail,material,textLabel,palette,trim,glow}){
 if(!arena.foundry)return;
 const copper=material('#bc7950',.65,.48),ivory=trim,
  dark=material('#25343d',.55,.65),mint=glow,amber=material('#e7b55b',.3,.45,true);
 palette.push(copper,dark,amber);
 const floor=(x,z)=>arena.terrain.height(x,z)??4;
 for(const b of arena.blocks){
  const base=floor(b.x,b.z),height=b.h-base;
  // Copper coping, cream structural band, inset vent shutters. The silhouette
  // remains exactly the collision box; highlights sit only centimetres proud.
  for(const sign of [-1,1]){
   detail(b.w,.24,.045,b.x,b.h-.12,b.z+sign*(b.d/2+.025),copper);
   detail(.045,.24,b.d,b.x+sign*(b.w/2+.025),b.h-.12,b.z,copper);
   if(height>3){
    detail(b.w,.32,.045,b.x,base+1.2,b.z+sign*(b.d/2+.025),ivory);
    for(let off=-b.w/2+.7;off<b.w/2-.4;off+=1.6){
     detail(.8,Math.min(2,height*.4),.05,b.x+off,base+height*.56,b.z+sign*(b.d/2+.03),dark);
     detail(.55,.08,.065,b.x+off,base+height*.56+.4,b.z+sign*(b.d/2+.04),b.kind==='siphon-pump'?amber:mint);
    }
   }
  }
  if(b.kind==='relay-stack'||b.kind==='siphon-pump'){
   // Recessed luminous heat-exchanger top, contained within the solid cap.
   detail(b.w-.5,.05,b.d-.5,b.x,b.h+.025,b.z,dark);
   for(let z=b.z-b.d/2+.6;z<b.z+b.d/2;z+=.8)detail(b.w-.9,.08,.16,b.x,b.h+.05,z,amber);
   for(let y=base+2;y<b.h-1;y+=2)for(const sign of [-1,1])detail(.09,.14,b.d+.08,b.x+sign*(b.w/2+.045),y,b.z,copper);
  }
  if(b.kind==='freight-container')for(let off=-b.w/2+.4;off<b.w/2;off+=.8)
   for(const sign of [-1,1])detail(.10,Math.max(.1,height-.4),.05,b.x+off,base+height/2,b.z+sign*(b.d/2+.025),copper);
 }
 // Roofs have inset traction slats; interrupted edge paint marks the accessible
 // ramp ends instead of suggesting a railing/obstacle which is not collidable.
 for(const r of arena.foundry.roofs){
  for(let x=Math.max(-119,r.x-r.length/2-r.ramp+1);x<Math.min(119,r.x+r.length/2+r.ramp);x+=2){
   const y=floor(x,r.z);
   detail(.16,.035,r.width-1.4,x,y+.025,r.z,copper);
   for(const sign of [-1,1])detail(.8,.035,.15,x,floor(x,r.z+sign*(r.width/2-.7))+.03,r.z+sign*(r.width/2-.7),ivory);
  }
 }
 // Freight loop lane paint. Chicanes are interrupted naturally at each solid.
 const road=arena.lanes.find(l=>l.kind==='vehicle-road');
 for(const route of [road.waypoints,...road.variants])for(let i=1;i<route.length;i++){
  const [ax,az]=route[i-1],[bx,bz]=route[i],length=Math.hypot(bx-ax,bz-az);
  for(let d=2;d<length;d+=6){
   const x=ax+(bx-ax)*d/length,z=az+(bz-az)*d/length,alongX=Math.abs(bx-ax)>Math.abs(bz-az);
   detail(alongX?2:.14,.025,alongX?.14:2,x,floor(x,z)+.018,z,ivory);
  }
 }
 for(const d of arena.traversal){
  const p=d.from,ink=d.kind==='teleporter'?mint:amber;
  detail(2,.10,2,p.x,p.y+.05,p.z,dark);
  for(const sign of [-1,1]){
   detail(2,.025,.10,p.x,p.y+.115,p.z+sign*.94,ink);
   detail(.10,.025,2,p.x+sign*.94,p.y+.115,p.z,ink);
  }
  const label=d.kind==='zipline'?'ZIP / E':d.kind==='jump-pad'?'LIFT / E':d.kind==='launcher'?'LAUNCH / E':'TRANSIT / E';
  textLabel(world,label,p.x,p.y+1.7,p.z,.3,d.kind==='teleporter'?'#72e0d0':'#e7b55b');
 }
 // Four-entry compounds read as different facilities at first glance. Ground
 // chevrons and apron markings lead to the actual clear mouths, not fake doors.
 for(const c of arena.foundry.compounds){
  const ink=c.kind==='economy'?amber:mint;
  const label=c.kind==='hq'?(c.x<0?'WEST COMMAND':'EAST COMMAND'):c.kind==='front'?(c.x<0?'WEST BASTION':'EAST BASTION'):c.kind==='economy'?(c.z<0?'NORTH SIPHON':'SOUTH SIPHON'):c.kind==='depot'?'PUMA / DEPOT':'FOUNDRY RELAY';
  if(c.kind==='depot'){
   for(const dz of [-5,5])detail(11,.025,.18,c.x,c.y+.025,c.z+dz,amber);
   for(const dx of [-5.5,5.5])detail(.18,.025,10,c.x+dx,c.y+.025,c.z,amber);
   textLabel(world,label,c.x,c.y+6,c.z-7,.6,'#e7b55b');
  }else{
   textLabel(world,label,c.x,c.y+(c.kind==='relay'?12:7),c.z,.65,c.kind==='economy'?'#e7b55b':'#b8eee2');
   for(const [dx,dz] of [[0,5],[0,-5],[5,0],[-5,0]]){
    const x=c.x+dx,z=c.z+dz;
    if(arena.blocks.some(b=>Math.abs(x-b.x)<b.w/2+.5&&Math.abs(z-b.z)<b.d/2+.5))continue;
    detail(dx?.15:2,.035,dz?.15:2,x,floor(x,z)+.025,z,ink);
   }
  }
 }
}

// Thin terrain-following capture boundaries preserve all the playable ground
// detail. The old full-radius cylinder is particularly opaque at HQ scale.
export function styleFoundryObjective(group,zone,arena){
 if(!arena.foundry)return;
 const {area,base,progress,radius,areaMat}=group.userData;
 const x=Number(zone.x)||0,z=Number(zone.z)||0,y=zone.y??arena.terrain.height(x,z)??0;
 const bend=geometry=>{
  const p=geometry.attributes.position;
  // RingGeometry is XY, then the mesh rotates -90 degrees about X.
  for(let i=0;i<p.count;i++)p.setZ(i,(arena.terrain.height(x+p.getX(i),z-p.getY(i))??y)-y);
  p.needsUpdate=true;geometry.computeVertexNormals();return geometry;
 };
 area.geometry.dispose();area.geometry=bend(new T.RingGeometry(Math.max(.1,radius-.28),radius,64));
 area.rotation.x=-Math.PI/2;area.position.y=.045;
 areaMat.transparent=true;areaMat.opacity=.36;areaMat.depthWrite=false;areaMat.side=T.DoubleSide;
 base.visible=false;bend(progress.geometry);
 group.userData.foundryRing=true;
}
