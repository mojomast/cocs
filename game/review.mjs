import {ArenaView} from './view.mjs';
import {Match,floorAt,obstructed,visible} from './core.mjs';
import {MAPS} from './maps.mjs';
import {WEAPONS} from './data.mjs';
import {CAMPAIGN_MISSIONS} from './campaign-data.mjs';

export function mountReview(canvas,panel,{runtime,onDisplay}={}){
 const params=new URLSearchParams(location.search),seed=Number(params.get('seed')||42);
 let rng=seed>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
 const view=new ArenaView(canvas);view.setDisplay({quality:'high',resolutionScale:1,fov:Number(params.get('fov')||82),reducedMotion:params.get('reduced')==='1'});view.setQuality('high');view.killcamEnabled=false;
 let match,raf=0,last=performance.now(),acc=0,paused=params.get('paused')==='1',ads=false,fire=false,sequence=null,disposed=false,reportAt=0;
 if(runtime)runtime.current={view,get match(){return match;},get ads(){return ads;}};
 const updateDisplay=next=>{view.setDisplay(next);onDisplay?.({...view.display});};
 onDisplay?.({...view.display});
 const keys=new Set(),frames=[],errors=[],status=document.createElement('pre');
 status.style.margin='6px 0 0';
 const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center';panel.append(row);
 const label=document.createElement('strong');label.textContent='PHASE 1 REVIEW — not visual approval';row.append(label);
 const select=(name,options,fn)=>{const s=document.createElement('select');s.setAttribute('aria-label',name);for(const [value,text] of options){const o=document.createElement('option');o.value=value;o.textContent=text;s.append(o);}s.onchange=()=>fn(s.value);row.append(s);return s;};
 const button=(name,fn)=>{const b=document.createElement('button');b.textContent=name;b.onclick=fn;row.append(b);return b;};
 const mapSelect=select('Map',MAPS.map(m=>[m.id,m.name]),id=>load(id));
 const weaponSelect=select('Weapon',WEAPONS.map((w,i)=>[String(i),w.name]),id=>{const p=match.actors[0];p.weapon=Number(id);p.weaponSwitch=.45;});
 const pointSelect=select('Inspection point',[],value=>go(Number(value)));
 let points=[];
 function load(id){
  const arena=MAPS.find(m=>m.id===id)||MAPS[0];rng=seed>>>0;
  match=new Match('chatgpt','openclaw',random,arena.id,{mode:arena.race?(arena.id==='puma-pitch'?'puma-soccer':'puma-race'):'deathmatch',botCount:1,unlimitedAmmo:true,fragLimit:100});
  for(const a of match.actors){a.bot=false;a.owned=WEAPONS.map(()=>true);a.weapon=Number(weaponSelect.value);}
  view.setMatch(match);view.setCinema(false);view.setFreeCam(false);view.playerId=match.actors[0].id;
  points=arena.spawns.map(([x,z],i)=>({name:`Spawn ${i+1}`,x,z}));
  for(const s of arena.structures||[]){if(['building','tunnel','cavern','bridge'].includes(s.type)){if(s.points)for(const [i,p] of s.points.entries())points.push({name:`${s.type} ${points.length} / ${i}`,x:p[0],y:p[1],z:p[2]});else points.push({name:`${s.type} ${points.length}`,x:s.x,z:s.z,y:s.y});}}
  for(const [name,p] of Object.entries(arena.anchors||{}))points.push({name,...p});
  for(const mission of CAMPAIGN_MISSIONS.filter(m=>m.mapId===arena.id))for(const step of mission.steps||[])if(step.marker)points.push({name:`${mission.id}: ${step.id}`,...step.marker});
  pointSelect.replaceChildren();points.forEach((p,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=p.name;pointSelect.append(o);});
  mapSelect.value=arena.id;frames.length=0;sequence=null;acc=0;
  const url=new URL(location.href);url.searchParams.set('map',arena.id);history.replaceState(null,'',url);
  if(params.get('overview')==='1')overview();
 }
 function overview(){const b=match.arena.bounds||{minX:-15,maxX:15,minZ:-15,maxZ:15},size=Math.max(b.maxX-b.minX,b.maxZ-b.minZ);view.setFreeCam(true);Object.assign(view.freePose,{x:(b.minX+b.maxX)/2,y:size*.92,z:(b.minZ+b.maxZ)/2+size*.45,yaw:0,pitch:-1.1});}
 function go(index){const p=points[index];if(!p)return;const a=match.actors[0],y=floorAt(p.x,p.z,match.arena);Object.assign(a,{x:p.x,z:p.z,y:y??p.y??0,yaw:0,pitch:0,vx:0,vy:0,vz:0});view.setFreeCam(false);view.resetPresentation?.();}
 button('Overview',overview);button('Player view',()=>view.setFreeCam(false));button('Free camera',()=>view.setFreeCam(!view.freeCam));
 button('Aim',()=>{ads=!ads;});button('Fire',()=>match.fire(match.actors[0]));button('Reload',()=>{const p=match.actors[0];p.ammo[p.weapon]=1;match.startReload(p,p.weapon);});
 button('ADS sequence',()=>{sequence={start:match.time};view.setFreeCam(false);});
 button('Death / respawn',()=>{const a=match.actors[1];if(!a)return;if(a.health<=0){match.spawn(a);}else{const p=match.actors[0];Object.assign(a,{x:p.x-Math.sin(p.yaw)*3,z:p.z-Math.cos(p.yaw)*3,y:p.y,health:0,dead:30});a.deaths++;}});
 button('Pause',()=>{paused=!paused;});
 select('FOV',[['65','FOV 65'],['82','FOV 82'],['100','FOV 100'],['110','FOV 110']],v=>updateDisplay({...view.display,fov:Number(v),quality:'high',resolutionScale:1})).value=String(view.display.fov);
 button('Reduced motion',()=>updateDisplay({...view.display,reducedMotion:!view.reduced(),quality:'high',resolutionScale:1}));
 button('Export metrics',()=>{const blob=new Blob([JSON.stringify(metrics(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`cocs-${match.arena.id}-${seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
 const help=document.createElement('div');help.textContent='Click viewport for mouse look; WASD move, Shift sprint, Space jump, C crouch, right mouse aim, left fire, R reload. Free camera: WASD + Q/E. Escape releases mouse. High quality pinned, scale 100%. Map seed is authored; review RNG seed controls actors.';panel.append(help,status);
 function metrics(){const ordered=frames.slice().sort((a,b)=>a-b);return {map:match.arena.id,seed,authoredSeed:match.arena.seed??null,renderer:view.renderer.isSoftware?'CPU software':view.renderer.getContext?.().getParameter(view.renderer.getContext().RENDERER),settings:{...view.display,quality:view.quality,dpr:devicePixelRatio},samples:frames.length,rafMedianMs:ordered[Math.floor(ordered.length*.5)]??null,rafP95Ms:ordered[Math.floor(ordered.length*.95)]??null,perf:{...view.perf},runtimeErrors:errors.slice()};}
 const down=e=>{if(e.target===canvas){if(e.button===0)fire=true;if(e.button===2)ads=true;}};
 const up=e=>{if(e.button===0)fire=false;if(e.button===2)ads=false;};
 const key=e=>{if(['INPUT','SELECT','BUTTON'].includes(e.target.tagName))return;keys.add(e.code);if(e.code==='Space')e.preventDefault();if(e.code==='KeyR')match.startReload(match.actors[0],match.actors[0].weapon);};
 const keyup=e=>keys.delete(e.code);
 const mouse=e=>{if(document.pointerLockElement!==canvas)return;const p=view.freeCam?view.freePose:match.actors[0];p.yaw-=e.movementX*.002;p.pitch=Math.max(-1.45,Math.min(1.45,p.pitch-e.movementY*.002));};
 const lock=()=>canvas.requestPointerLock?.();const context=e=>e.preventDefault();const blur=()=>{keys.clear();fire=false;ads=false;};
 canvas.addEventListener('click',lock);canvas.addEventListener('contextmenu',context);window.addEventListener('keydown',key);window.addEventListener('keyup',keyup);window.addEventListener('mousemove',mouse);window.addEventListener('mousedown',down);window.addEventListener('mouseup',up);window.addEventListener('blur',blur);
 load(params.get('map')||'colosseum');
 function frame(now){if(disposed)return;try{const elapsed=Math.max(0,now-last),dt=Math.min(.1,elapsed/1000);last=now;if(frames.length>=240)frames.shift();frames.push(elapsed);
  const p=match.actors[0];let x=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),z=(keys.has('KeyS')?1:0)-(keys.has('KeyW')?1:0);
  if(sequence){const t=match.time-sequence.start;ads=(t>.5&&t<1.6)||(t>2&&t<2.12)||(t>2.24&&t<3.5);fire=t>1&&t<1.25;if(t>4){sequence=null;ads=false;fire=false;}}
  if(view.freeCam){const c=view.freePose,s=dt*15;c.x+=(x*Math.cos(c.yaw)+z*Math.sin(c.yaw))*s;c.z+=(-x*Math.sin(c.yaw)+z*Math.cos(c.yaw))*s;c.y+=((keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0))*s;x=z=0;}
  if(!paused){acc=Math.min(acc+dt,5/60);while(acc>=1/60){match.step(1/60,{x,z,yaw:p.yaw,pitch:p.pitch,ads,fire,jump:keys.has('Space'),crouch:keys.has('KeyC'),sprint:keys.has('ShiftLeft')});acc-=1/60;}}
  view.aim=ads;view.render('playing',match,dt,match.time);
  if(now-reportAt>1000){reportAt=now;const m=metrics();status.textContent=`${match.arena.id} | ${m.renderer} | ${m.perf.viewport?.bufferWidth}×${m.perf.viewport?.bufferHeight} | draw ${m.perf.calls} | triangles ${m.perf.triangles} | geometries ${m.perf.geometries} | textures ${m.perf.textures} | frame median ${m.rafMedianMs?.toFixed(1)} ms\nPlayer ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} | blocked ${obstructed(p.x,p.y,p.z,.35,match.arena)} | ${paused?'paused':'running'}`;}
 }catch(e){const message=String(e?.stack||e);if(errors.at(-1)!==message){errors.push(message);if(errors.length>32)errors.shift();console.error('Review runtime:',message);}status.textContent=message;paused=true;}raf=requestAnimationFrame(frame);}
 window.__cocsReview={spatial:{floorAt,obstructed,visible},get match(){return match;},view,load,overview,go,metrics,points:()=>points,sequence:()=>{sequence={start:match.time};},setAim:v=>{ads=!!v;},pause:v=>{paused=!!v;}};
 raf=requestAnimationFrame(frame);
 return()=>{disposed=true;cancelAnimationFrame(raf);canvas.removeEventListener('click',lock);canvas.removeEventListener('contextmenu',context);window.removeEventListener('keydown',key);window.removeEventListener('keyup',keyup);window.removeEventListener('mousemove',mouse);window.removeEventListener('mousedown',down);window.removeEventListener('mouseup',up);window.removeEventListener('blur',blur);delete window.__cocsReview;if(runtime)runtime.current=null;view.dispose?.();panel.replaceChildren();};
}
