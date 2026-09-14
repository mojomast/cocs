import {buildInteriors,interiorAt,interiorCenter} from './interiors.mjs';

export const CAMERA_RIGS=['orbit','chase','dolly','crane','tripod','follow','firstperson','flyover'];

const HIGHLIGHTS={death:true,explosion:true,capture:true,'flag-pickup':true,'flag-return':true,'vehicle-destroyed':true,'vehicle-splatter':true,'payload-delivered':true,'assault-breach':true};
const MAX_PITCH=1.45;
const clamp=(v,lo,hi)=>v<lo?lo:v>hi?hi:v;
const num=(v,d=0)=>Number.isFinite(v)?v:d;
const fin=(v,d=0)=>Number.isFinite(v)?v:d;
const isAlive=a=>!!a&&!a.dead&&num(a.health,1)>0;
const selectable=a=>isAlive(a)&&a.id!==null&&a.id!==undefined;

export class CinematicDirector{
 constructor(options={}){
  const reduced=options.reduced;
  this.random=typeof options.random==='function'?options.random:Math.random;
  this.center={x:num(options.center&&options.center.x),z:num(options.center&&options.center.z)};
  this.radius=Math.max(1,num(options.radius,14));
  this.cutEvery=Math.max(.1,num(options.cutEvery,3.2));
  this.reduced=reduced===true||(reduced===undefined&&typeof globalThis!=='undefined'&&typeof globalThis.matchMedia==='function'&&globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  this._rig='orbit';
  this._targetId=null;
  this._poiIndex=0;
  this._pois=this._fallbackPois();
  this._actors=[];
  this._pos={x:this.center.x,y:3.5,z:this.center.z+this.radius};
  this._heading=0;
  this._roll=0;
  this._fov=70;
  this._lookYaw=0;
  this._lookPitch=0;
  this._time=0;
  this._lastCutTime=-Infinity;
  this._needsCut=true;
  this._forceCut=false;
  this._seen=new Set();
  this.tour=options.tour===true;
  this._autoCut=options.autoCut!==false;
  this.tourRadius=Number.isFinite(options.tourRadius)?Math.max(6,options.tourRadius):Math.max(14,this.radius*2.2);
  this.aim={x:this.center.x,y:1.5,z:this.center.z};
  this._action=null;
  this.interiors=buildInteriors(options.structures);
  this._interiorVol=null;
  this._interiorHold=0;
  if(this.tour)this._rig='flyover';
 }

 get rig(){return this._rig;}
 get targetId(){return this._targetId??null;}
 get poiIndex(){return this._poiIndex;}
 get autoCut(){return this._autoCut;}

 setReduced(value){this.reduced=value===true;return this.reduced;}

 setAutoCut(value){this._autoCut=value!==false;return this._autoCut;}

 setRig(name){if(!CAMERA_RIGS.includes(name))return false;this._rig=name;return true;}

 cycleRig(dir=1){
  const n=CAMERA_RIGS.length,step=Math.round(num(dir,1));
  const i=((CAMERA_RIGS.indexOf(this._rig)%n)+n)%n;
  this._rig=CAMERA_RIGS[((i+step)%n+n)%n];
  return this._rig;
 }

 setTarget(id){
  if(id===null||id===undefined){this._targetId=null;return true;}
  const actor=this._actors.find(a=>a.id===id);
  if(actor&&isAlive(actor)){this._targetId=id;return true;}
  return false;
 }

 cycleTarget(state,dir=1){
  const s=state&&typeof state==='object'?state:{};
  const actors=Array.isArray(s.actors)?s.actors:this._actors;
  const alive=actors.filter(selectable);
  if(!alive.length){this._targetId=null;return null;}
  const step=Math.round(num(dir,1))||1;
  let idx=alive.findIndex(a=>a.id===this._targetId);
  idx=idx<0?0:((idx+step)%alive.length+alive.length)%alive.length;
  this._targetId=alive[idx].id;
  return this._targetId;
 }

 setPoi(index){const n=this._pois.length;this._poiIndex=n?clamp(Math.round(num(index)),0,n-1):0;return this._poiIndex;}

 cyclePoi(dir=1){const n=this._pois.length||1;this._poiIndex=((this._poiIndex+Math.round(num(dir,1)))%n+n)%n;return this._poiIndex;}

 look(deltaYaw,deltaPitch=0){
  this._lookYaw+=num(deltaYaw);
  this._lookPitch=clamp(this._lookPitch+num(deltaPitch),-MAX_PITCH,MAX_PITCH);
  return {yaw:this._lookYaw,pitch:this._lookPitch};
 }

 resetLook(){this._lookYaw=0;this._lookPitch=0;}

 cut(){this._forceCut=true;}

 reframe(state){
  const s=state&&typeof state==='object'?state:{};
  this._actors=Array.isArray(s.actors)?s.actors:[];
  this._refreshPois(s);
  if(this._targetId!=null&&!this._actorById(this._targetId))this._targetId=null;
  if(this._targetId==null){
   const alive=this._actors.filter(selectable);
   if(alive.length)this._targetId=alive[Math.floor(this.random()*alive.length)].id;
  }
  return this;
 }

 update(state,dt,events){
  const step=clamp(num(dt,1/60),1/240,.1);
  const s=state&&typeof state==='object'?state:{};
  if(Array.isArray(s.actors))this._actors=s.actors;
  this._refreshPois(s);
  if(this.tour)this.aim=this._actionPoint(s,step);
  let time;
  if(Number.isFinite(s.time)){time=s.time;this._time=time;}else{this._time+=step;time=this._time;}
  const raw=Array.isArray(events)?events:(Array.isArray(s.events)?s.events:[]);
  let highlight=null;
  for(const ev of raw){
   if(!ev||typeof ev!=='object')continue;
   const key=this._eventKey(ev);
   if(this._seen.has(key))continue;
   this._remember(key);
   if(HIGHLIGHTS[ev.type]||(ev.type==='melee'&&ev.hit!=null))highlight=ev;
  }
  let target=this._actorById(this._targetId);
  if(this._targetId!=null&&!target)this._targetId=null;
  const timeCut=!this.tour&&time-this._lastCutTime>=this.cutEvery;
  const highlightCut=!this.tour&&!!highlight&&!this.reduced;
  const autoCut=this._needsCut||timeCut||highlightCut;
  const cutoff=autoCut||this._forceCut;
  if(autoCut){
   if(!this.tour&&this._autoCut){this._rig=this._pickRig(this._rig);this._targetId=this._pickTarget(highlight);target=this._actorById(this._targetId);}
   this._lastCutTime=time;
   this._needsCut=false;
  }
  this._forceCut=false;
  const pose=this._rigPose(time,target,step);
  const px=fin(pose.x,this.center.x),py=fin(pose.y,3.5),pz=fin(pose.z,this.center.z);
  const ph=fin(pose.heading,this._heading),pr=fin(pose.roll,0);
  const k=this._rig==='firstperson'?1:1-Math.exp(-3*step);
  if(cutoff){
   this._pos.x=px;this._pos.y=py;this._pos.z=pz;
   this._heading=ph;this._roll=0;
  }else{
   this._pos.x+=(px-this._pos.x)*k;
   this._pos.y+=(py-this._pos.y)*k;
   this._pos.z+=(pz-this._pos.z)*k;
   this._heading=this._dampAngle(this._heading,ph,k);
   this._roll+=(pr-this._roll)*(1-Math.exp(-3*step));
  }
  let baseYaw,basePitch;
  if(this._rig==='firstperson'&&target){
   baseYaw=num(target.yaw,0);basePitch=num(target.pitch,0);
  }else{
   const aim=this.tour?this.aim:this._aimPoint(target);
   if(!this.tour)this.aim={x:aim.x,y:aim.y,z:aim.z};
   const dx=aim.x-this._pos.x,dy=aim.y-this._pos.y,dz=aim.z-this._pos.z;
   const horizontal=Math.hypot(dx,dz);
   baseYaw=Math.atan2(-dx,-dz);
   basePitch=horizontal<1e-6?(dy>=0?Math.PI/2:-Math.PI/2):Math.atan2(dy,horizontal);
  }
  const yaw=fin(baseYaw+this._lookYaw,baseYaw);
  const pitch=clamp(fin(basePitch+this._lookPitch,basePitch),-MAX_PITCH,MAX_PITCH);
  const roll=this.reduced?0:clamp(fin(this._roll),-.15,.15);
  const speed=target?Math.hypot(num(target.vx),num(target.vz)):0;
  let want=this.tour?72:target?66+4*clamp(speed/6,0,1):70;
  if(!this.tour&&target&&(target.sprinting===true||speed>6.5))want+=8*clamp(Math.max(target.sprinting===true?1:0,(speed-6.5)/2),0,1);
  want=clamp(want,55,85);
  this._fov+=(want-this._fov)*(1-Math.exp(-3*step));
  return {
   x:fin(this._pos.x,this.center.x),y:fin(this._pos.y,3.5),z:fin(this._pos.z,this.center.z),
   yaw:fin(yaw),pitch:fin(pitch),roll:fin(roll),fov:fin(this._fov,70),
   cut:cutoff,rig:this._rig,target:this._targetId??null,
  };
 }

 _refreshPois(s){
  const zones=s&&s.objectives&&Array.isArray(s.objectives.zones)?s.objectives.zones:[];
  const pois=[];
  for(const z of zones)if(z&&Number.isFinite(z.x)&&Number.isFinite(z.z))pois.push({x:z.x,z:z.z});
  this._pois=pois.length?pois:this._fallbackPois();
  const n=this._pois.length||1;
  this._poiIndex=((this._poiIndex%n)+n)%n;
 }

 _fallbackPois(){
  const n=5,out=[];
  for(let i=0;i<n;i++){
   const a=(i/n)*Math.PI*2+.6;
   out.push({x:this.center.x+Math.cos(a)*this.radius,z:this.center.z+Math.sin(a)*this.radius});
  }
  return out;
 }

 _actorById(id){if(id===null||id===undefined)return null;return this._actors.find(a=>a.id===id)||null;}

 _aimPoint(target){if(!target)return {x:this.center.x,y:1.5,z:this.center.z};return {x:num(target.x),y:num(target.y)+1.2,z:num(target.z)};}

 _interiorVolume(step){
  if(!this.interiors?.length)return null;
  const vol=interiorAt(this.interiors,this.aim);
  if(vol){this._interiorVol=vol;this._interiorHold=.8;return vol;}
  if(this._interiorHold>0){this._interiorHold-=step;return this._interiorVol;}
  this._interiorVol=null;return null;
 }

 _actionPoint(s,step){
  const actors=[];
  for(const a of Array.isArray(s?.actors)?s.actors:[]){if(a&&num(a.health,0)>0&&Number.isFinite(a.x)&&Number.isFinite(a.z))actors.push(a);}
  let tx=this.center.x,ty=1.5,tz=this.center.z;
  if(actors.length){
   let bestN=0,bx=0,by=0,bz=0;
   for(const a of actors){let n=0,sx=0,sy=0,sz=0;for(const b of actors){if(Math.abs(b.x-a.x)<=22&&Math.abs(b.z-a.z)<=22){n++;sx+=b.x;sy+=num(b.y)+1.2;sz+=b.z;}}if(n>bestN){bestN=n;bx=sx/n;by=sy/n;bz=sz/n;}}
   if(bestN<=1){let sx=0,sy=0,sz=0;for(const a of actors){sx+=a.x;sy+=num(a.y)+1.2;sz+=a.z;}tx=sx/actors.length;ty=sy/actors.length;tz=sz/actors.length;}
   else{tx=bx;ty=by;tz=bz;}
  }
  if(!this._action)this._action={x:tx,y:ty,z:tz};
  else{const k=1-Math.exp(-3*clamp(num(step,1/60),0,.1));this._action.x+=(tx-this._action.x)*k;this._action.y+=(ty-this._action.y)*k;this._action.z+=(tz-this._action.z)*k;}
  return this._action;
 }

 _dampAngle(a,b,k){const d=Math.atan2(Math.sin(b-a),Math.cos(b-a));return a+d*k;}

 _rigPose(time,target,step){
  const base=target?{x:num(target.x),y:num(target.y),z:num(target.z)}:{x:this.center.x,y:1.5,z:this.center.z};
  const speed=target?Math.hypot(num(target.vx),num(target.vz)):0;
  const heading=target&&speed>.5?Math.atan2(-num(target.vx),-num(target.vz)):target?num(target.yaw):0;
  const rig=this._rig;
  let x=base.x,y=base.y,z=base.z,h=heading,roll=0;
  if(rig==='flyover'){
   const vol=this._interiorVolume(step);
   if(vol){
    const c=interiorCenter(vol,this.aim)||this.aim,maxR=vol.kind==='box'?Math.min(vol.hw,vol.hd):vol.r,R=Math.max(1.2,Math.min(this.tourRadius,maxR*.6)),a=time*.34;
    x=c.x+Math.cos(a)*R;z=c.z+Math.sin(a)*R;
    if(vol.kind==='seg')y=clamp(this.aim.y+1.1,c.y+1,c.y+vol.r+.7);
    else{const ceil=vol.base+(vol.height??4);y=clamp(this.aim.y+2.2,vol.base+.9,ceil-.6);}
    h=Math.atan2(-(this.aim.x-x),-(this.aim.z-z));
    roll=Math.sin(time*.4)*.03;
   }else{
    const c=this.aim||this.center,R=this.tourRadius,a=time*.28,w=.9+.08*Math.sin(time*.13);
    x=c.x+Math.cos(a)*R*w;z=c.z+Math.sin(a)*R*w;
    y=14+2.5*Math.sin(time*.19)+1.2*Math.sin(time*.43);
    h=Math.atan2(-(c.x-x),-(c.z-z));
    roll=Math.sin(time*.37)*.035;
   }
  }else if(rig==='orbit'||!target){
   const angle=time*.5+.7,r=this.radius*(1+.2*Math.sin(time*.37));
   x=base.x+Math.cos(angle)*r;z=base.z+Math.sin(angle)*r;y=base.y+3.5;h=angle+Math.PI;
  }else if(rig==='chase'){
   const dist=this.reduced?5.6:6.5,height=this.reduced?2.3:2.6;
   const sin=Math.sin(heading),cos=Math.cos(heading);
   x=base.x+sin*dist;z=base.z+cos*dist;y=base.y+height;
   const lateral=speed>.5?num(target.vx)*Math.cos(heading)-num(target.vz)*Math.sin(heading):0;
   roll=clamp(-lateral*.015,-.1,.1);
  }else if(rig==='follow'){
   const back=this.reduced?2.6:3.2,height=this.reduced?1.6:1.9,side=this.reduced?.8:1.1;
   const sin=Math.sin(heading),cos=Math.cos(heading);
   x=base.x+sin*back+cos*side;
   z=base.z+cos*back-sin*side;
   y=base.y+height;
  }else if(rig==='tripod'){
   const poi=this._pois[this._poiIndex]||this.center;
   x=num(poi.x,this.center.x);z=num(poi.z,this.center.z);
   y=Number.isFinite(poi.y)?poi.y:Math.max(base.y+1.6,2.6);
  }else if(rig==='dolly'){
   const n=this._pois.length||1;
   const a=this._pois[(this._poiIndex%n+n)%n];
   const b=this._pois[((this._poiIndex+1)%n+n)%n];
   const t=((time%7)+7)%7/7,e=t*t*(3-2*t);
   const ax=num(a.x,this.center.x),az=num(a.z,this.center.z);
   const bx=num(b.x,this.center.x),bz=num(b.z,this.center.z);
   const ay=Number.isFinite(a.y)?a.y:2.2,by=Number.isFinite(b.y)?b.y:4.6;
   x=ax+(bx-ax)*e;z=az+(bz-az)*e;y=ay+(by-ay)*e;
   roll=Math.sin(time*.3)*.03;
  }else if(rig==='crane'){
   x=base.x+Math.sin(time*.3)*2;
   z=base.z+Math.cos(time*.3)*2;
   y=base.y+4.3+2.7*Math.sin(time*.6);
   roll=Math.sin(time*.4)*.05;
  }else if(rig==='firstperson'){
   x=base.x;y=base.y+1.55;z=base.z;h=num(target.yaw,0);
  }
  if(this.reduced)roll=0;
  return {x,y,z,heading:h,roll};
 }

 _pickRig(current){
  const weights={orbit:1.5,chase:3,dolly:1,crane:2,tripod:1,follow:3,firstperson:1,flyover:0};
  const pool=[];
  for(const rig of CAMERA_RIGS){
   if(rig===current||!(weights[rig]>0))continue;
   const weight=Math.max(1,Math.round((weights[rig]??1)*2));
   for(let i=0;i<weight;i++)pool.push(rig);
  }
  if(!pool.length)return current;
  return pool[Math.floor(this.random()*pool.length)];
 }

 _pickTarget(highlight){
  const actors=this._actors;
  const alive=actors.filter(selectable);
  const byId=new Map(actors.map(a=>[a.id,a]));
  const refs=[];
  if(highlight){
   for(const key of ['actor','killer','source','attacker','capturer','victim']){
    const value=highlight[key];
    if(value!==null&&value!==undefined&&byId.has(value))refs.push(value);
   }
   const list=highlight.actors||highlight.targets;
   if(Array.isArray(list))for(const value of list)if(byId.has(value))refs.push(value);
  }
  const unique=[...new Set(refs)];
  const aliveRef=unique.filter(id=>selectable(byId.get(id)));
  if(aliveRef.length)return this._biasPick(aliveRef);
  if(highlight&&highlight.pos&&alive.length){
   const px=num(highlight.pos.x),pz=num(highlight.pos.z);
   let best=alive[0],bestD=Infinity;
   for(const a of alive){const d=Math.hypot(num(a.x)-px,num(a.z)-pz);if(d<bestD){bestD=d;best=a;}}
   return best.id;
  }
  if(alive.length)return this._biasPick(alive.map(a=>a.id));
  if(unique.length)return unique[0];
  if(actors.length)return actors[Math.floor(this.random()*actors.length)].id;
  return null;
 }

 _biasPick(ids){
  let id=ids[Math.floor(this.random()*ids.length)];
  if(id===this._targetId&&ids.length>1){
   const others=ids.filter(value=>value!==id);
   id=others[Math.floor(this.random()*others.length)];
  }
  return id;
 }

 _eventKey(ev){
  const id=Number.isFinite(ev.id)?ev.id:'';
  const t=Number.isFinite(ev.time)?ev.time:'';
  const pos=ev.pos&&Number.isFinite(ev.pos.x)?`${ev.pos.x},${ev.pos.z}`:'';
  return `${ev.type}|${id}|${t}|${ev.actor??''}|${ev.team??''}|${pos}`;
 }

 _remember(key){this._seen.add(key);if(this._seen.size>1024)this._seen.clear();}
}
