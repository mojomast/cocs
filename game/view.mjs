import * as T from 'three';
import {SoftwareRenderer} from './software.mjs';
import {CHARACTERS,WEAPONS} from './data.mjs';
import {aim} from './core.mjs';
import {MAPS,pickupWeapon} from './maps.mjs';
import {normalizeDisplay} from './config.mjs';
import {WeaponFeedback,EffectPool} from './feedback.mjs';
import {ModelAssets,withAssets,currentAssets,CameraShake,MuzzleLightPool,LowHealthOverlay,RailBeamPool,DeathPool} from './effects-fx.mjs';
import {deathPlan,hashUnit} from './deaths.mjs';
import {resolveFinish} from './cosmetics.mjs';
import {CharacterRig} from './character-anim.mjs';
import {terrainTriangles,terrainWallTriangles} from './terrain.mjs';
import {TEAM_PALETTE,teamPresentation,teamMark,updateTeamMark,applyActorTeam} from './team-presentation.mjs';
import {spectateActor} from './hud.mjs';
import {NEUTRAL} from './radar.mjs';
import {cavernShell} from './structures.mjs';
import {raceDemoMode,raceDemoPose,RACE_DEMO_MODE_SECONDS} from './race-camera.mjs';
import {occlusionDistance} from './camera.mjs';
import {postStage,applyComposerSize,disposeComposer,reducedMotion} from './post.mjs';
import {surfaceTextures,clearSurfaceTextures} from './textures.mjs';
import {addSky,addMountains,addScatter} from './environment.mjs';
import {raceTrackModel,updateRace as syncRacePresentation} from './race-presentation.mjs';
export {raceTrackModel};
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {VignetteShader} from 'three/addons/shaders/VignetteShader.js';
export {SynthAudio} from './feedback.mjs';
// Shadows are re-rendered on a fixed cadence instead of every frame; the arena
// bake still refreshes immediately on build, and moving actors lag at most one step.
export const SHADOW_REFRESH_INTERVAL=2;
export function shadowTick(previous,interval=SHADOW_REFRESH_INTERVAL){const step=Math.max(1,interval),next=(Number.isFinite(previous)?previous:0)+1;return next>=step?{tick:0,refresh:true}:{tick:next,refresh:false};}
export const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const buildMaterial=(color,metal=.5,rough=.42,emissive=false)=>new T.MeshStandardMaterial({color,metalness:metal,roughness:rough,...(emissive?{emissive:color,emissiveIntensity:1.6}:{})});
// Arena/palette materials stay uncached; shared model assets opt into the cache via withAssets.
export const material=(color,metal=.5,rough=.42,emissive=false)=>{const assets=currentAssets();return assets?assets.material(`${color}|${metal}|${rough}|${emissive?1:0}`,()=>buildMaterial(color,metal,rough,emissive)):buildMaterial(color,metal,rough,emissive);};
function geometry(scope,key,make){const assets=scope===undefined?currentAssets():scope;return assets?assets.geometry(key,make):make();}
export function box(parent,w,h,d,x,y,z,mat,assets){const m=new T.Mesh(geometry(assets,`b|${w}|${h}|${d}`,()=>new T.BoxGeometry(w,h,d)),mat);m.position.set(x,y,z);parent.add(m);return m;}
function cylinder(parent,r1,r2,h,x,y,z,mat,segments=12,assets){const m=new T.Mesh(geometry(assets,`c|${r1}|${r2}|${h}|${segments}`,()=>new T.CylinderGeometry(r1,r2,h,segments)),mat);m.position.set(x,y,z);parent.add(m);return m;}
export function ring(parent,r,t,x,y,z,mat,rx=Math.PI/2,assets){const m=new T.Mesh(geometry(assets,`t|${r}|${t}`,()=>new T.TorusGeometry(r,t,6,32)),mat);m.position.set(x,y,z);m.rotation.x=rx;parent.add(m);return m;}
function tube(parent,ax,ay,az,bx,by,bz,r,mat,segments=6,assets){const start=V(ax,ay,az),dir=V(bx-ax,by-ay,bz-az),length=dir.length()||.0001,m=new T.Mesh(geometry(assets,`u|${r}|${length}|${segments}`,()=>new T.CylinderGeometry(r,r,length,segments)),mat);m.position.copy(start).addScaledVector(dir,.5);m.quaternion.setFromUnitVectors(V(0,1,0),dir.normalize());parent.add(m);return m;}
const shadeHash=(x,y,z,seed)=>{let h=Math.imul((x|0)+374761393,668265263)^Math.imul((y|0)+1274126177,2246822519)^Math.imul((z|0)+2654435761,3266489917)^Math.imul(seed|0,668265263);h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967295;};
// Deterministic per-vertex luminance jitter plus a per-triangle tint. Seeded, never Math.random.
function paintGeometry(geometry,seed=1,jitter=.16,tint=[1,1,1]){
 if(!geometry?.attributes?.position)return geometry;
 const position=geometry.attributes.position,count=position.count,indexed=!!geometry.index,colors=new Float32Array(count*3);
 if(indexed)for(let i=0;i<count;i++){const m=(1-jitter*.5)+jitter*shadeHash(Math.round(position.getX(i)*5),Math.round(position.getY(i)*5),Math.round(position.getZ(i)*5),seed);colors[i*3]=tint[0]*m;colors[i*3+1]=tint[1]*m;colors[i*3+2]=tint[2]*m;}
 else for(let i=0;i<count;i+=3){const cx=(position.getX(i)+position.getX(i+1)+position.getX(i+2))/3,cy=(position.getY(i)+position.getY(i+1)+position.getY(i+2))/3,cz=(position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))/3,tri=(1-jitter*.5)+jitter*shadeHash(Math.round(cx*5),Math.round(cy*5),Math.round(cz*5),seed);for(let k=0;k<3;k++){const j=i+k,m=tri*((1-jitter*.5*.3)+jitter*.3*shadeHash(Math.round(position.getX(j)*13),Math.round(position.getY(j)*13),Math.round(position.getZ(j)*13),seed+31));colors[j*3]=tint[0]*m;colors[j*3+1]=tint[1]*m;colors[j*3+2]=tint[2]*m;}}
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 return geometry;
}
const arenaSeedOf=arena=>String(arena?.id||'arena').split('').reduce((hash,char)=>(Math.imul(hash,31)+char.charCodeAt(0))>>>0,7);
const terrainTextureKind=key=>({grass:'grass',dirt:'sand',rock:'rock',cliff:'rock',concrete:'concrete',metal:'metal',ice:'ice',sand:'sand',snow:'ice',ash:'rock',stone:'rock',lava:'rock'}[key]||'rock');
// Collision proxies that next-gen maps render as smooth geometry instead of a box.
const NEXTGEN_PROXY=new Set(['cave','tunnel','rock','tree','crate','column']);
const weaponInfo=type=>WEAPONS[type]||{color:['#ff6f91','#e8ff71','#ff9f43'][Math.abs(type)%3],name:`Weapon ${type}`,short:`W${type}`,feel:{}};
const weaponVisualKey=visual=>{if(!visual)return '';try{return JSON.stringify(visual);}catch{return String(visual);}};
export function weaponModel(type=0,assets,visual=null,finish=null){return withAssets(assets,()=>{type=Number.isInteger(type)&&type>=0?type:0;const info=weaponInfo(type),finishColors=resolveFinish(finish,null),g=new T.Group(),dark=material(finishColors?.secondary||'#222f37'),light=material(finishColors?.accent||'#73848a'),glow=material(finishColors?.primary||info.color,.3,.3,true);g.userData.type=type;
  if(type===0){box(g,.2,.23,.62,0,0,-.15,dark);box(g,.24,.1,.34,0,.16,-.18,light);box(g,.07,.045,.48,.105,.06,-.2,glow);const barrel=cylinder(g,.07,.07,.5,0,.01,-.6,light);barrel.rotation.x=Math.PI/2;box(g,.09,.17,.12,0,.25,-.03,dark);box(g,.09,.2,.14,0,-.19,.03,dark);}
 if(type===1){const barrel=cylinder(g,.22,.24,.9,0,0,-.25,dark);barrel.rotation.x=Math.PI/2;ring(g,.205,.037,0,0,-.72,glow,0);box(g,.3,.09,.55,0,.23,-.15,light);box(g,.15,.25,.19,0,-.26,.02,light);for(const x of [-.24,.24])box(g,.04,.24,.38,x,0,-.25,glow);}
 if(type===2){box(g,.21,.22,.7,0,0,-.26,dark);for(const x of [-.14,.14]){box(g,.075,.1,.92,x,.025,-.58,light);box(g,.035,.045,.8,x,.085,-.58,glow);}box(g,.15,.08,.25,0,.2,-.17,glow);box(g,.08,.2,.13,0,-.2,0,dark);}
 if(type===3){box(g,.36,.22,.5,0,0,-.1,dark);for(const x of [-.12,.12]){const barrel=cylinder(g,.095,.095,.58,x,.03,-.51,light);barrel.rotation.x=Math.PI/2;ring(g,.075,.017,x,.03,-.81,glow,0);}box(g,.32,.1,.25,0,-.13,-.32,glow);box(g,.12,.24,.13,0,-.22,.09,dark);}
  if(type===4){box(g,.23,.24,.62,0,0,-.2,dark);for(const z of [-.25,-.45,-.65])ring(g,.17,.025,0,0,z,glow,0);const core=new T.Mesh(new T.IcosahedronGeometry(.12,1),glow);core.position.z=-.67;g.add(core);for(const x of [-.18,.18])box(g,.08,.14,.7,x,0,-.3,light);box(g,.13,.22,.15,0,-.21,.05,dark);}
  if(type===5){box(g,.28,.22,.55,0,.04,-.12,dark);const drum=cylinder(g,.29,.29,.38,0,-.17,-.23,light,12);drum.rotation.z=Math.PI/2;drum.name='grenade-drum';for(let i=0;i<6;i++){const a=i*Math.PI/3;const chamber=cylinder(g,.07,.07,.4,0,-.17+Math.cos(a)*.21,-.23+Math.sin(a)*.21,dark,8);chamber.rotation.z=Math.PI/2;box(g,.018,.06,.06,.21,-.17+Math.cos(a)*.21,-.23+Math.sin(a)*.21,glow);}const barrel=cylinder(g,.145,.17,.48,0,.04,-.65,dark);barrel.rotation.x=Math.PI/2;ring(g,.15,.035,0,.04,-.89,light,0);box(g,.06,.23,.06,0,.27,-.44,light);}
  if(type===6){box(g,.24,.24,.5,0,0,-.08,dark);const emitter=new T.Mesh(new T.OctahedronGeometry(.15),glow);emitter.position.set(0,0,-.69);emitter.name='shock-emitter';g.add(emitter);for(const x of [-.19,.19]){box(g,.085,.16,.62,x,0,-.48,light);box(g,.055,.08,.22,x,0,-.87,glow);}for(const z of [-.2,-.34,-.48])ring(g,.19,.025,0,0,z,glow,0);box(g,.3,.12,.22,0,-.19,-.06,light);}
  if(type===7){box(g,.4,.32,.48,0,0,-.06,dark);const barrel=cylinder(g,.28,.21,.62,0,0,-.61,light,8);barrel.rotation.x=Math.PI/2;barrel.name='flak-barrel';ring(g,.245,.05,0,0,-.93,dark,0);for(let i=0;i<8;i++){const a=i*Math.PI/4;box(g,.06,.06,.36,Math.cos(a)*.25,Math.sin(a)*.25,-.6,dark);}box(g,.32,.2,.3,0,-.26,-.1,light);for(const x of [-.16,0,.16])box(g,.075,.035,.22,x,.18,-.05,glow);}
  if(type===8){box(g,.2,.2,.72,0,0,-.28,dark);const scope=cylinder(g,.06,.06,.4,0,.26,-.22,dark);scope.rotation.x=Math.PI/2;ring(g,.052,.012,0,.26,-.44,glow,0);box(g,.24,.5,.22,0,-.1,-.1,light);const barrel=cylinder(g,.055,.055,.8,0,0,-.78,light);barrel.rotation.x=Math.PI/2;box(g,.24,.14,.3,0,.16,-.02,dark);for(const x of [-.11,.11])box(g,.05,.24,.36,x,-.2,.08,light);box(g,.2,.08,.24,0,.22,-.5,glow);box(g,.09,.18,.12,.15,.05,.02,light);box(g,.09,.18,.12,-.15,.05,.02,light);box(g,.12,.3,.16,0,-.26,.16,light);box(g,.16,.06,.4,0,.3,-.34,glow);}
  if(type===9){box(g,.28,.24,.46,0,0,-.08,dark);const barrel=cylinder(g,.085,.085,.5,0,.03,-.58,light);barrel.rotation.x=Math.PI/2;box(g,.1,.1,.28,0,.03,-.4,glow);box(g,.14,.34,.14,0,-.24,.06,dark);box(g,.2,.24,.2,0,.16,.12,glow);for(const x of [-.15,.15])box(g,.06,.2,.28,x,-.02,.02,light);box(g,.14,.3,.1,0,.02,.2,light);box(g,.08,.16,.1,0,.02,.3,dark);box(g,.06,.1,.16,.13,.1,.02,glow);box(g,.16,.14,.34,0,.26,-.16,dark);box(g,.1,.08,.2,0,-.02,-.5,glow);}
  // Mechanical details distinguish the original five as well as the heavy weapons.
  if(type===0){box(g,.13,.27,.2,0,-.25,-.19,light);for(const z of [-.22,-.32,-.42])box(g,.225,.025,.04,0,.02,z,dark);box(g,.18,.2,.22,0,0,.25,light);box(g,.1,.04,.07,.15,.09,.04,light);}
  if(type===1){ring(g,.24,.035,0,0,.2,light,0);box(g,.07,.16,.28,.28,.22,-.05,dark);for(const z of [-.12,-.24,-.36])box(g,.12,.035,.045,0,.29,z,glow);box(g,.32,.08,.18,0,-.24,.17,dark);}
  if(type===2){const scope=cylinder(g,.07,.07,.32,0,.25,-.24,dark);scope.rotation.x=Math.PI/2;ring(g,.06,.013,0,.25,-.405,glow,0);for(const z of [-.4,-.58,-.76])box(g,.34,.035,.05,0,-.04,z,dark);}
  if(type===3){box(g,.34,.12,.22,0,-.1,-.59,light);for(const z of [-.53,-.6,-.67])box(g,.35,.035,.025,0,-.17,z,dark);for(const x of [-.22,.22])box(g,.06,.13,.12,x,0,-.1,glow);}
  if(type===4){for(const x of [-.22,.22]){const cell=cylinder(g,.075,.075,.25,x,-.06,.07,glow,8);cell.rotation.x=Math.PI/2;box(g,.12,.045,.3,x,.04,.07,dark);}ring(g,.17,.03,0,0,-.73,light,0);}
  if(type>=5){box(g,.12,.25,.16,0,-.26,.12,dark);box(g,.2,.2,.22,0,0,.26,light);}
  const points=[[[0,.01,-.85]],[[0,0,-.76]],[[0,.025,-1.04]],[[-.12,.03,-.82],[.12,.03,-.82]],[[0,0,-.77]],[[0,.04,-.93]],[[0,0,-.99]],[[0,0,-.99]]][type]||[[0,0,-.83]];
  const muzzle=info.feel?.muzzle||[.12,.06],flash=new T.Group(),anchors=[];for(const point of points){const anchor=new T.Group();anchor.position.set(...point);anchor.name='muzzle';g.add(anchor);anchors.push(anchor);const flare=new T.Mesh(new T.SphereGeometry(muzzle[0],6,4),new T.MeshBasicMaterial({color:info.color}));flare.position.copy(anchor.position);flare.scale.z=1.5;flash.add(flare);}  flash.visible=false;g.add(flash);g.userData.flash=flash;g.userData.muzzles=anchors;g.userData.muzzle=anchors[0];g.userData.feel=info.feel;
  if(visual){const acc=material(visual.color||'#8affc1',.4,.3,true),mod=material('#161d22',.6,.5);
   if(visual.optic==='scope'){const s=cylinder(g,.06,.06,.5,0,.28,-.18,mod,10);s.rotation.x=Math.PI/2;ring(g,.055,.014,0,.28,-.44,acc,0);}
   else if(visual.optic==='holo'){box(g,.12,.1,.16,0,.3,-.2,acc);}
   else if(visual.optic==='iron'){box(g,.1,.07,.1,0,.3,-.16,mod);}
   if(visual.barrel==='long'){const b=cylinder(g,.052,.046,.55,0,.02,-.88,mod,10);b.rotation.x=Math.PI/2;ring(g,.062,.014,0,.02,-1.12,acc,0);}
   else if(visual.barrel==='heavy'){const b=cylinder(g,.09,.08,.55,0,.02,-.88,mod,10);b.rotation.x=Math.PI/2;ring(g,.105,.02,0,.02,-1.12,acc,0);}
   else if(visual.barrel==='short'){const b=cylinder(g,.072,.072,.18,0,.02,-.56,mod,10);b.rotation.x=Math.PI/2;}
   else if(visual.barrel==='dual'){for(const x of [-.14,.14]){const b=cylinder(g,.04,.04,.42,x,.02,-.8,mod,8);b.rotation.x=Math.PI/2;ring(g,.05,.012,x,.02,-.99,acc,0);}}
   if(visual.magazine==='drum'){const d=cylinder(g,.15,.15,.26,0,-.24,-.14,mod,12);d.rotation.z=Math.PI/2;ring(g,.155,.018,0,-.24,-.14,acc,Math.PI/2);}
   else if(visual.magazine==='extended'){box(g,.11,.26,.13,0,-.26,-.1,mod);}
   const rail=visual.underbarrel;
   if(rail&&rail!=='none'){
    box(g,.05,.07,.2,0,-.16,-.04,mod);
    if(rail==='quickdraw-grip'){box(g,.045,.17,.045,0,-.26,-.02,acc);box(g,.07,.045,.1,0,-.35,.01,acc);}
    else if(rail==='burst-module'){box(g,.11,.11,.16,0,-.2,-.05,acc);ring(g,.055,.012,0,-.2,-.14,mod,0);for(const x of [-.035,.035])box(g,.018,.05,.05,x,-.2,-.14,acc);}
    else if(rail==='grenade-launcher'){const tube=cylinder(g,.052,.056,.36,0,-.2,-.36,mod,8);tube.rotation.x=Math.PI/2;ring(g,.058,.014,0,-.2,-.55,acc,0);box(g,.08,.08,.16,0,-.2,-.12,acc);}
    else if(rail==='homing-beacon'){box(g,.075,.14,.1,0,-.22,-.02,acc);const mast=cylinder(g,.012,.012,.18,0,-.08,-.02,acc,6);const tip=new T.Mesh(new T.OctahedronGeometry(.035),acc);tip.position.set(0,-.02,-.02);g.add(tip);}
    else if(rail==='chain-capacitor'){box(g,.1,.1,.18,0,-.2,-.08,acc);for(const z of [-.02,-.12])ring(g,.05,.012,0,-.2,z,acc,0);box(g,.02,.16,.14,.06,-.2,-.08,mod);}
    else{box(g,.09,.12,.22,0,-.21,-.06,acc);}
   }
  }
  return g;});}
function hornetModel(){const g=new T.Group();g.name='hornet';const hull=material('#3c4652',.7,.4),dark=material('#20262e',.6,.5),accent=material('#ffb35c',.4,.3,true),glass=material('#20323d',.6,.12);
 box(g,1.1,.7,4.6,0,0,-.1,hull);box(g,.7,.5,1.2,0,.25,1.6,hull);
 const nose=new T.Mesh(new T.ConeGeometry(.5,1.4,10),hull);nose.rotation.x=-Math.PI/2;nose.position.set(0,0,-2.6);g.add(nose);
 const canopy=new T.Mesh(new T.SphereGeometry(.62,12,8),glass);canopy.scale.set(1,.7,1.5);canopy.position.set(0,.5,.2);g.add(canopy);
 for(const s of [-1,1]){const wing=box(g,2.6,.14,1.5,s*1.7,0,.2,hull);wing.rotation.z=s*.05;box(g,.5,.3,.9,s*2.3,0,.5,dark);box(g,.16,.5,.9,s*2.3,-.1,.5,accent);}
 box(g,1.8,.12,.7,0,.35,2.1,hull);box(g,.12,.7,1,0,.6,2.4,dark);
 const engines=[],guns=[];
 for(const s of [-1,1]){const nac=cylinder(g,.4,.46,1.8,s*1.7,-.1,.6,dark,12);nac.rotation.x=Math.PI/2;const glow=new T.Mesh(new T.CylinderGeometry(.34,.34,.2,12),accent);glow.rotation.x=Math.PI/2;glow.position.set(s*1.7,-.1,1.55);g.add(glow);engines.push(glow);}
 for(const s of [-1,1]){const mount=new T.Group();mount.position.set(s*1.6,-.05,-1.2);g.add(mount);const barrel=cylinder(mount,.09,.09,1.2,0,0,-.6,dark,8);barrel.rotation.x=Math.PI/2;const flash=new T.Mesh(new T.SphereGeometry(.16,6,4),new T.MeshBasicMaterial({color:'#ffd9a0'}));flash.position.set(0,0,-1.2);flash.visible=false;mount.add(flash);guns.push({mount,barrel,flash});}
 g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
 g.userData={kind:'hornet',vehicle:true,wheels:[],turret:null,barrels:engines,guns,flashUntil:0,color:'#5c6b7a'};return g;}
export function vehicleModel(kind='puma',assets){return withAssets(assets,()=>{
 if(kind==='hornet')return hornetModel();
 const g=new T.Group();g.name='warthog';
 const cache=new Map();
 const matc=(color,metal=.5,rough=.42,emissive=false,opts={})=>{const key=`${color}|${metal}|${rough}|${emissive?1:0}|${opts.transparent?1:0}|${opts.opacity??1}`;let mat=cache.get(key);if(!mat){mat=material(color,metal,rough,emissive);if(opts.transparent){mat.transparent=true;mat.opacity=opts.opacity??.55;}if(opts.flat)mat.flatShading=true;cache.set(key,mat);}return mat;};
 const olive=matc('#5f6338',.35,.72),khaki=matc('#b3a06b',.18,.8),dark=matc('#262a22',.5,.55),tire=matc('#1c1c1c',.04,.96),steel=matc('#b9c0c4',.85,.32),glass=matc('#22343d',.6,.12,false,{transparent:true,opacity:.5}),amber=matc('#fff2c0',.2,.35,true);
 // Dark skid plate and olive hull tub.
 box(g,1.92,.12,3.36,0,.16,0,dark);
 box(g,1.62,.46,2.86,0,.52,-.02,olive);
 box(g,1.84,.22,2.3,0,.4,0,dark);
 // Stepped hood, grille slats and bumper.
 box(g,1.62,.3,1.06,0,.76,1.02,olive);
 box(g,1.16,.18,.52,0,.96,.72,khaki);
 box(g,1.5,.42,.14,0,.64,1.58,dark);
 box(g,1.62,.08,.1,0,.86,1.55,olive);
 for(let i=0;i<4;i++)box(g,1.28,.05,.08,0,.48+i*.1,1.66,steel);
 box(g,1.86,.2,.22,0,.4,1.74,dark);
 // Emissive headlights.
 for(const x of [-.54,.54]){const headlight=cylinder(g,.1,.1,.08,x,.72,1.66,amber,10);headlight.rotation.x=Math.PI/2;}
 // Windshield, dash, steering wheel and two front seats.
 box(g,1.32,.56,.05,0,1.16,.64,glass).rotation.x=-.2;
 box(g,1.36,.16,.36,0,.92,.36,dark);
 const steering=new T.Mesh(new T.TorusGeometry(.15,.028,6,20),dark);steering.position.set(.4,1.02,.26);steering.rotation.x=1.15;g.add(steering);
 for(const x of [-.4,.4]){box(g,.5,.12,.52,x,.82,.06,khaki);box(g,.5,.5,.12,x,1.06,-.2,khaki);box(g,.3,.18,.1,x,1.3,-.22,dark);}
 // Open rear bed with side walls and tailgate.
 box(g,1.5,.1,1.2,0,.62,-.88,olive);
 for(const x of [-.71,.71])box(g,.12,.42,1.2,x,.79,-.88,olive);
 box(g,1.5,.42,.1,0,.79,-.37,olive);
 box(g,1.5,.38,.12,0,.78,-1.48,khaki);
 // Roll cage: A-pillars, roof rails, rear stays, cross braces and bed braces.
 for(const x of [-.66,.66]){tube(g,x,.9,.5,x,1.56,.32,.035,dark);tube(g,x,1.56,.32,x,1.56,-.7,.035,dark);tube(g,x,1.56,-.7,x*1.22,1.0,-1.24,.035,dark);tube(g,x,1.18,-.7,x,.9,-.7,.03,dark);}
 tube(g,-.66,1.56,.32,.66,1.56,.32,.035,dark);
 tube(g,-.7,1.56,-.7,.7,1.56,-.7,.035,dark);
 tube(g,-.5,1.56,-.2,.5,1.56,-.2,.03,dark);
 // Four fender arches over the wheels.
 for(const x of [-1.0,1.0])for(const z of [-1.25,1.25]){const arch=new T.Mesh(new T.TorusGeometry(.55,.07,6,14,Math.PI),dark);arch.position.set(x,.42,z);arch.rotation.y=Math.PI/2;g.add(arch);}
 // Four off-road tires on six-spoke hubs, grouped so they can spin.
 const wheels=[];
 for(const x of [-.98,.98])for(const z of [-1.25,1.25]){const group=new T.Group();group.position.set(x,.42,z);g.add(group);const tyre=cylinder(group,.42,.42,.3,0,0,0,tire,16);tyre.rotation.z=Math.PI/2;const hub=cylinder(group,.2,.2,.34,0,0,0,steel,12);hub.rotation.z=Math.PI/2;for(let i=0;i<3;i++){const spoke=box(group,.07,.72,.07,0,0,0,steel);spoke.rotation.x=i*Math.PI/3;}wheels.push(group);}
 // Emissive tail lights and two whip antennas.
 for(const x of [-.54,.54])box(g,.18,.14,.05,x,.72,-1.62,amber);
 for(const x of [-.62,.62])tube(g,x,.95,-1.3,x*1.12,1.92,-1.42,.02,steel);
 // Rotating turret: ring mount, armored receiver, gun shield, ammo box and clustered barrels.
 const turret=new T.Group();turret.position.set(0,1.05,-1.0);g.add(turret);
 ring(turret,.34,.06,0,0,0,dark);
 cylinder(turret,.15,.17,.2,0,.12,0,olive,12);
 box(turret,.56,.3,.6,0,.34,.06,olive);
 box(turret,.66,.5,.08,0,.44,.36,dark);
 box(turret,.24,.3,.42,.38,.34,-.08,khaki);
 cylinder(turret,.13,.13,.5,0,.34,.38,steel,10).rotation.x=Math.PI/2;
 const barrels=[],guns=[];
 for(const x of [-.13,.13]){const mount=new T.Group();mount.position.set(x,.34,.5);turret.add(mount);const barrel=cylinder(mount,.055,.055,1.1,0,0,.35,steel,10);barrel.rotation.x=Math.PI/2;const flash=new T.Mesh(new T.SphereGeometry(.14,6,4),new T.MeshBasicMaterial({color:'#fff2c0'}));flash.position.set(0,0,.92);flash.visible=false;mount.add(flash);barrels.push(barrel);guns.push({mount,barrel,flash});}
 ring(turret,.17,.03,0,.34,.78,steel,0);
 g.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
  g.userData={kind,vehicle:true,wheels,turret,barrels,guns,flashUntil:0,color:'#5f6338'};
  return g;
});}
export function robotModel(id,assets){return withAssets(assets,()=>{const c=CHARACTERS.find(ch=>ch.id===id)||CHARACTERS[0],g=new T.Group(),armor=new T.MeshStandardMaterial({color:c.accent,metalness:.72,roughness:.32}),color=material(c.color,.6,.3),dark=material('#18262c',.5,.5),glow=material(c.color,.4,.2,true);
 // Smooth capsule limbs and ball joints read as a rounded operator rather than a stack of boxes.
 const capsule=(parent,r,len,mat,seg=10)=>{const m=new T.Mesh(geometry(undefined,`cap|${r}|${len}|${seg}`,()=>new T.CapsuleGeometry(r,len,4,seg)),mat);parent.add(m);return m;};
 const ball=(parent,r,mat,seg=12)=>{const m=new T.Mesh(geometry(undefined,`sph|${r}|${seg}`,()=>new T.SphereGeometry(r,seg,Math.max(6,Math.round(seg*.65)))),mat);parent.add(m);return m;};
 const root=new T.Group();g.add(root);
 const hips=new T.Group();hips.position.y=1.02;root.add(hips);ball(hips,.17,dark,12).scale.set(1.15,.7,.9);
 const torso=new T.Group();torso.position.y=.2;hips.add(torso);
 const torsoMesh=ball(torso,.26,armor,16);torsoMesh.scale.set(1.02,1.32,.7);
 const chest=new T.Group();chest.position.y=.34;torso.add(chest);
 ball(chest,.25,armor,16).scale.set(1.16,.92,.74);
 const emblem=ball(chest,.085,glow,10);emblem.position.set(0,0,-.2);emblem.scale.set(1,.5,.35);
 const head=new T.Group();head.position.y=.34;chest.add(head);
 ball(head,.19,armor,16).scale.set(.96,1.04,.98);
 const visor=ball(head,.14,dark,12);visor.position.set(0,.01,-.09);visor.scale.set(1.02,.46,.6);
 const eye=ball(head,.075,glow,10);eye.position.set(0,.015,-.19);eye.scale.set(1.05,.42,.5);
 if(id==='chatgpt')ring(head,.17,.018,0,.02,0,glow,Math.PI/2);
 if(id==='claude'){for(const x of [-.2,.2]){const fin=ball(head,.07,color,8);fin.position.set(x,.05,.02);fin.scale.set(.6,1.7,.9);}const crest=ball(chest,.06,color,8);crest.position.set(0,.16,-.22);crest.scale.set(.5,1.6,.5);}
 if(id==='grok'){const ant=cylinder(head,.012,.012,.34,0,.28,.02,dark,6);const tip=ball(head,.035,glow,8);tip.position.set(.16,.3,.02);}
 if(id==='meta'){for(const x of [-.13,.13])ring(chest,.11,.02,x,.05,-.19,glow,0);}
 if(id==='gemini'){for(const x of [-.11,.11]){const star=ball(head,.055,glow,8);star.position.set(x,.01,-.2);}const spine=ball(chest,.05,color,8);spine.position.set(0,.05,-.24);spine.scale.set(.5,2.4,.5);}
 if(id==='deepseek'){const crest=ball(head,.06,color,8);crest.position.set(0,.2,.02);crest.scale.set(.6,1.8,.8);}
 if(id==='mistral'){for(let i=0;i<3;i++){const fin=ball(head,.05,color,8);fin.position.set(.08-i*.08,.16+i*.03,0);fin.scale.set(1.4,.5,.7);}}
 if(id==='kimi')ring(head,.2,.02,0,.03,0,glow,Math.PI/3);
 if(id==='qwen'){for(let i=0;i<3;i++){const plate=ball(chest,.2-i*.03,color,12);plate.position.set(0,.02+i*.08,-.05);plate.scale.set(1.05,.3,.5);}}
 const arms={},legs={};
 for(const side of [-1,1]){const key=side<0?'L':'R';
  const shoulder=new T.Group();shoulder.position.set(side*.3,.22,0);chest.add(shoulder);ball(shoulder,.13,armor,12).scale.set(1.02,.9,1.02);
  const upper=new T.Group();shoulder.add(upper);capsule(upper,.082,.2,color).position.y=-.14;
  const elbow=new T.Group();elbow.position.y=-.29;upper.add(elbow);ball(elbow,.082,dark,10);
  const fore=new T.Group();elbow.add(fore);capsule(fore,.068,.19,dark).position.y=-.13;ball(fore,.078,armor,10).position.y=-.26;
  arms[key]={shoulder,upper,fore,elbow};
  const hip=new T.Group();hip.position.set(side*.15,0,0);hips.add(hip);ball(hip,.115,dark,10);
  const upperLeg=new T.Group();hip.add(upperLeg);capsule(upperLeg,.1,.25,armor).position.y=-.17;
  const knee=new T.Group();knee.position.y=-.34;upperLeg.add(knee);ball(knee,.09,dark,10);
  const lower=new T.Group();knee.add(lower);capsule(lower,.082,.23,dark).position.y=-.16;
  const foot=new T.Group();foot.position.y=-.35;lower.add(foot);const footMesh=ball(foot,.105,armor,10);footMesh.position.set(0,-.02,-.07);footMesh.scale.set(1.05,.7,1.6);
  legs[key]={hip,upper:upperLeg,knee,lower,foot};
 }
 const gunAnchor=new T.Group();gunAnchor.position.set(.16,0,-.26);chest.add(gunAnchor);const weapon=weaponModel(0,assets);weapon.scale.setScalar(.7);gunAnchor.add(weapon);
 const shield=new T.Mesh(new T.SphereGeometry(1.15,16,12),new T.MeshBasicMaterial({color:c.color,transparent:true,opacity:.13,wireframe:true}));shield.scale.set(.7,1,.7);shield.position.y=.9;g.add(shield);shield.visible=false;
 const base=new T.Mesh(new T.RingGeometry(.47,.54,28),new T.MeshBasicMaterial({color:c.color,side:T.DoubleSide,transparent:true,opacity:.7}));base.rotation.x=-Math.PI/2;base.position.y=.02;g.add(base);
 const teamMarks=[];for(const z of [-.29,.19]){const mark=teamMark();mark.position.set(0,.91,z);if(z>0)mark.rotation.y=Math.PI;g.add(mark);teamMarks.push(mark);updateTeamMark(mark,null);}
 g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
 const joints={root,rootBaseY:0,hips,torso,chest,head,armUpperL:arms.L.upper,armUpperR:arms.R.upper,forearmL:arms.L.fore,forearmR:arms.R.fore,legUpperL:legs.L.upper,legUpperR:legs.R.upper,legLowerL:legs.L.lower,legLowerR:legs.R.lower,footL:legs.L.foot,footR:legs.R.foot};
 g.userData={limbs:[],head,torso:torsoMesh,chest,torsoGroup:torso,gunAnchor,weapon,shield,color:c.color,armor,armorColor:c.accent,base,teamMarks,rig:new CharacterRig(joints),joints};return g;});}
export function textLabel(parent,text,x,y,z,size=1,color='#8ad9d3',ry=0){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.font='bold 78px monospace';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,256,90);const tex=new T.CanvasTexture(canvas);const m=new T.Mesh(new T.PlaneGeometry(size*4,size),new T.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));m.position.set(x,y,z);m.rotation.y=ry;m.userData.label=text;m.userData.labelSize=size*.6;parent.add(m);return m;}
function pointOf(value){if(Array.isArray(value))return {x:+value[0]||0,y:value.length>2?(+value[1]||0):0,z:+value[value.length>2?2:1]||0};return value?.position||value||{};}
// Payload yaw follows the route tangent. Local play exposes the full route on
// objectiveState while snapshots only carry the current position, so fall back to
// the frame-to-frame delta when no path is available.
function payloadTangent(payload,previous){
 const path=payload?.path;
 if(Array.isArray(path)&&path.length>1){
  const distances=payload.waypointDistance||[],distance=Number.isFinite(payload.distance)?payload.distance:0;
  let index=0;while(index<path.length-2&&distance>(distances[index+1]??0))index++;
  const from=path[index],to=path[index+1]||from,dx=(to.x??0)-(from.x??0),dz=(to.z??0)-(from.z??0);
  if(Math.hypot(dx,dz)>1e-6)return Math.atan2(dx,dz);
 }
 const position=payload?.position;
 if(previous&&position){const dx=(position.x??0)-previous.x,dz=(position.z??0)-previous.z;if(Math.hypot(dx,dz)>1e-6)return Math.atan2(dx,dz);}
 return NaN;
}
function arenaBounds(arena){if(arena.bounds){const b=arena.bounds;return {minX:b.minX??b.left??-14,maxX:b.maxX??b.right??14,minZ:b.minZ??b.top??-14,maxZ:b.maxZ??b.bottom??14};}return {minX:-14,maxX:14,minZ:-14,maxZ:14};}
function traversalItems(arena,name){const t=arena.traversal||arena.traversalMetadata||{};return t[name]||arena[name]||[];}
// Surface palettes remain readable in the CPU renderer, which has no shader lighting.
const arenaLooks={
 'puma-circuit':['#292d34','#343c49','#b08042','#ffe1af','#17222d',.006,.35],
 exchange:['#253d40','#182b30','#72918b','#c3ffe9','#163d39',.016,.62],
 crosswire:['#302d45','#242139','#777091','#d8ceff','#29203f',.022,.55],
 foundry:['#48332a','#302723','#a38061','#ffd3a0','#4b2116',.024,.7],
 launchpad:['#324657','#243340','#8da5b1','#d7efff','#20364f',.012,.65],
 citadel:['#514739','#39332c','#b4a080','#ffe4b4','#45351e',.02,.18],
 'blood-gulch':['#788653','#706958','#b3ab8c','#fff0ce','#575638',.004,.06],
 skybreak:['#36515b','#263944','#9dbcc0','#d5f6ff','#253e59',.006,.45],
 aether:['#3c3553','#29233e','#a091bd','#e7d7ff','#372050',.009,.48],
 'sunscar-canyon':['#938459','#89624a','#ceac79','#ffe0ac','#6b4933',.0045,.04],
 'ironfall-megastructure':['#3d4145','#292f36','#b58b73','#ffd3bb','#293445',.01,.78],
 'longreach-plateau':['#637458','#535f51','#a6b396','#e5f3d2','#384d49',.004,.08],
 frostline:['#c4d8e6','#8fa8ba','#e6f3ff','#f6fbff','#8a939c',.0055,.5],
 'derelict-station':['#24313a','#1a242c','#7fa39b','#bfeee2','#111a20',.009,.72],
  'ashen-rift':['#3a2118','#2a1712','#a86444','#ffb27a','#1c0f0a',.011,.6],
  'neon-vertical':['#2a2f4a','#1c2138','#8f9bd0','#d6e0ff','#141830',.02,.7],
  substation:['#2c3a33','#1e2a25','#8fb3a3','#cdeee0','#101915',.03,.6],
  warfront:['#4a3d2e','#33291f','#b39a6f','#ffe6b8','#241a12',.009,.35],
  'skyfall-basin':['#2f4152','#223140','#8fb0c7','#dbeeff','#132131',.008,.55],
  trenchline:['#4b4632','#332f22','#b0a077','#ffe7b6','#221e14',.008,.32],
  'signal-ridge':['#343d46','#242b32','#8fa3af','#d7ecff','#18202a',.01,.6],
  rampart:['#3a3a44','#282830','#9a9aa8','#e2e2ff','#1b1b24',.018,.7],
  'catwalk-breach':['#37302c','#24201e','#a88d7a','#ffd9c0','#16110f',.016,.72],
  colosseum:['#4a3b2c','#2e2419','#c9a86a','#ffe6b8','#1a120b',.011,.25],
  'frost-gate':['#dfeefb','#9fb6c8','#eaf6ff','#ffffff','#7d8ea0',.006,.4],
  'sunken-hill':['#6f8f5a','#4a5f3d','#b6cf9a','#e8f6d8','#2f3d28',.0065,.15],
  riverbend:['#8a7a5c','#5f5138','#d8c39a','#fff0cf','#3a2f1e',.008,.3],
  fortress:['#5a4a3e','#3a2f27','#b09070','#ffd9b0','#241a12',.01,.6],
  atrium:['#2f4652','#20323c','#9fbccb','#e6f6ff','#132028',.009,.72],
  catacombs:['#3a3348','#241f30','#9a8ec0','#e8dcff','#120f1c',.016,.55],
  slagworks:['#5a2e22','#3a1d16','#c07a4a','#ffcfa0','#1d0c07',.013,.5],
  forge:['#4a4030','#2f281d','#c4a86a','#ffe9b0','#1c150c',.012,.62],
  'titan-valley':['#556b52','#3a4a38','#a9c09a','#e8f6dc','#22301f',.0055,.2],
  'convoy-line':['#5a4a34','#332a1e','#d0b276','#ffeccb','#1f170d',.011,.48],
  'proving-grounds':['#33513d','#213528','#93c79a','#dcffdf','#13251a',.015,.55],
  };
export class ArenaView{
 constructor(canvas){const context=canvas.getContext('webgl2',{antialias:true,alpha:false});this.renderer=context?new T.WebGLRenderer({canvas,context,antialias:true,alpha:false,powerPreference:'high-performance'}):new SoftwareRenderer(canvas);this.display=normalizeDisplay();this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;this.composer=null;this._postW=0;this._postH=0;this.motionQuery=typeof window!=='undefined'?window.matchMedia?.('(prefers-reduced-motion: reduce)'):undefined;
  this.scene=new T.Scene();this.scene.background=new T.Color('#090f17');this.scene.fog=new T.FogExp2('#090f17',.018);this.camera=new T.PerspectiveCamera(82,1,.08,220);this.camera.rotation.order='YXZ';this.scene.add(new T.HemisphereLight('#b2eeff','#1f252c',2));const sun=new T.DirectionalLight('#c9e5ef',2.8);sun.position.set(3,12,8);sun.castShadow=this.renderer.isSoftware!==true;if(sun.shadow){sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0006;sun.shadow.normalBias=.03;}this.sun=sun;this.sunTarget=new T.Object3D();this.scene.add(this.sunTarget);sun.target=this.sunTarget;this.scene.add(sun);
  if(this.renderer.isSoftware!==true&&this.renderer.shadowMap){this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;this.renderer.shadowMap.needsUpdate=true;}
  if(this.renderer.isSoftware!==true&&this.renderer.capabilities&&typeof document!=='undefined'){try{const pmrem=new T.PMREMGenerator(this.renderer);this.environmentRT=pmrem.fromScene(new RoomEnvironment(),.04);this.scene.environment=this.environmentRT.texture;this.scene.environmentIntensity=.5;pmrem.dispose();}catch{}}
      this.renderResources=new Set();this.sharedResources=new Set();this.modelAssets=new ModelAssets();this.buildArena();this.actorModels=new Map();this.vehicleModels=new Map();this.pickupModels=[];this.flagModels=new Map();this.lastEvent=0;this.flashUntil=0;this.playerId=0;this.spectator=false;this.spectatorTarget=null;this.spectatorThird=false;this.hands=new T.Group();this.camera.add(this.hands);this.scene.add(this.camera);this.currentWeapon=-1;this.aim=false;this.lowHealth=false;this.cameraShake=new CameraShake();this.muzzleLights=null;this.lowHealthOverlay=null;this.railPool=null;this.deathPool=null;this.deathContext=new Map();this.payloadModel=null;if(this.renderer.isSoftware!==true){this.muzzleLights=new MuzzleLightPool(this.scene,2);this.lowHealthOverlay=new LowHealthOverlay(this.camera);if(typeof document!=='undefined')this.railPool=new RailBeamPool(this.scene,6);}this.menu=this.makeMenu();this.cinema=false;this.director=null;this._freeCam=false;this._directorLock=false;this.freePose={x:0,y:6,z:0,yaw:0,pitch:0};this.showcaseState=null;this.previewRect=null;this.raycaster=new T.Raycaster();this._occClear=0;this.resize();}
      reduced(){return reducedMotion(this.display?.reducedMotion, Boolean(this.motionQuery?.matches));}
      setDisplay(prefs){const display=normalizeDisplay(prefs),scaleChanged=display.resolutionScale!==this.display?.resolutionScale;this.display=display;this.camera.fov=display.fov;this.camera.updateProjectionMatrix();this.showWeapon=display.showWeapon;if(scaleChanged)this.resize();else this._syncPost?.();}
   setPlayerId(id){if(this.playerId!==id){this.feedback?.reset();this.flashUntil=0;this.cameraShake?.reset();this.lowHealth=false;}this.playerId=id;}
   setAim(on){this.aim=on===true;}
   setSpectator(on){this.spectator=on===true;}
  setSpectatorTarget(id){this.spectatorTarget=Number.isInteger(id)?id:null;}
  setSpectatorThird(value){this.spectatorThird=value===true;}
   setCinema(on){this.cinema=on===true;if(!this.cinema){this._camWant=undefined;this._raceCam=undefined;this._freeCam=false;this._directorLock=false;this.resetFreeCam();}}
   setDirector(director){this.director=director||null;}
   setFreeCam(on){const next=on===true;if(next&&!this._freeCam){const position=this.camera?.position,rotation=this.camera?.rotation;this.freePose={x:Number.isFinite(position?.x)?position.x:0,y:Number.isFinite(position?.y)?position.y:6,z:Number.isFinite(position?.z)?position.z:0,yaw:Number.isFinite(rotation?.y)?rotation.y:0,pitch:Number.isFinite(rotation?.x)?rotation.x:0};}if(!next){this._camWant=undefined;this._raceCam=undefined;}this._freeCam=next;}
   setDirectorLock(on){this._directorLock=on===true;}
   get freeCam(){return this._freeCam===true;}
   get directorLock(){return this._directorLock===true;}
   resetFreeCam(){this.freePose={x:0,y:6,z:0,yaw:0,pitch:0};}
   freeLook(dyaw,dpitch){const pose=this.freePose??(this.freePose={x:0,y:6,z:0,yaw:0,pitch:0});pose.yaw=(Number.isFinite(pose.yaw)?pose.yaw:0)+(Number.isFinite(dyaw)?dyaw:0);pose.pitch=Math.max(-1.5,Math.min(1.5,(Number.isFinite(pose.pitch)?pose.pitch:0)+(Number.isFinite(dpitch)?dpitch:0)));}
   updateFreeCam(dt,{forward=0,right=0,up=0,boost=false}={}){const pose=this.freePose??(this.freePose={x:0,y:6,z:0,yaw:0,pitch:0});const step=Math.min(Math.max(Number.isFinite(dt)?dt:0,0),.1),speed=16*(boost===true?2.4:1),fwd=Number.isFinite(forward)?forward:0,strafe=Number.isFinite(right)?right:0,rise=Number.isFinite(up)?up:0,cy=Math.cos(pose.yaw||0),sy=Math.sin(pose.yaw||0),cp=Math.cos(pose.pitch||0),sp=Math.sin(pose.pitch||0),distance=speed*step;pose.x+=distance*(fwd*(-cp*sy)+strafe*cy);pose.y+=distance*(fwd*sp+rise);pose.z+=distance*(fwd*(-cp*cy)+strafe*(-sy));if(!(pose.y>=.4))pose.y=.4;if(!Number.isFinite(pose.x))pose.x=0;if(!Number.isFinite(pose.z))pose.z=0;if(!Number.isFinite(pose.yaw))pose.yaw=0;if(!Number.isFinite(pose.pitch))pose.pitch=0;return pose;}
   setShowcase(state){this.showcaseState=state||null;}
   setPreviewRect(rect){this.previewRect=rect||null;}
   cinemaLook(dy,dp){this.director?.look?.(dy,dp);}
    resize(){const w=Math.max(1,this.renderer.domElement.clientWidth),h=Math.max(1,this.renderer.domElement.clientHeight),dpr=window.devicePixelRatio,baseline=this.renderer.isSoftware?.85:Math.min(Number.isFinite(dpr)&&dpr>0?dpr:1,1.5),ratio=baseline*(this.display?.resolutionScale??1);
     if(this.width===w&&this.height===h&&this.pixelRatio===ratio){this._syncPost?.();return;}
     if(this.pixelRatio!==ratio)this.renderer.setPixelRatio(ratio);
     // Keep even tiny/hidden canvases at least one backing pixel without changing CSS size.
     this.renderer.setSize(Math.max(w,1/ratio),Math.max(h,1/ratio),false);this.width=w;this.height=h;this.pixelRatio=ratio;
     this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.menu.camera.aspect=w/h;this.menu.camera.updateProjectionMatrix();this._syncPost?.();}
    _syncPost(){const eligible=this.renderer instanceof T.WebGLRenderer,want=postStage({eligible,reduced:this.reduced(),scale:this.display?.resolutionScale});if(!want){if(this.composer){disposeComposer(this.composer);this.composer=null;}this._postW=0;this._postH=0;this._postRatio=0;return;}if(!this.composer){try{const composer=new EffectComposer(this.renderer);composer.addPass(new RenderPass(this.scene,this.camera));composer.addPass(new UnrealBloomPass(new T.Vector2(1,1),.38,.7,.85));const vignette=new ShaderPass(VignetteShader);vignette.uniforms.offset.value=1.05;vignette.uniforms.darkness.value=1.05;composer.addPass(vignette);composer.addPass(new OutputPass());this.composer=composer;this._postW=0;this._postH=0;this._postRatio=0;}catch{this.composer=null;return;}}const w=Math.max(1,this.renderer.domElement.clientWidth),h=Math.max(1,this.renderer.domElement.clientHeight),ratio=this.pixelRatio??1;if(this._postW!==w||this._postH!==h||this._postRatio!==ratio){applyComposerSize(this.composer,w,h,ratio);this._postW=w;this._postH=h;this._postRatio=ratio;}}
    buildArena(arena=MAPS[0]){return withAssets(this.arenaAssets??=new ModelAssets(),()=>this._buildArena(arena));}
    _buildArena(arena=MAPS[0]){if(this.worldGroup){this.scene.remove(this.worldGroup);this.disposeObject(this.worldGroup);for(const resource of this.renderResources||[])resource.dispose();this.renderResources?.clear();this.flagAssets=null;}this.objectiveModels=new Map();this.mapId=arena.id;const world=new T.Group();this.worldGroup=world;this.scene.add(world);this.scene.background=new T.Color(arena.background);this.scene.fog=new T.FogExp2(arena.background,.018);const bounds=arenaBounds(arena),legacy=!arena.bounds,minX=bounds.minX,maxX=bounds.maxX,minZ=bounds.minZ,maxZ=bounds.maxZ,width=maxX-minX,depth=maxZ-minZ;
    const look=arenaLooks[arena.id]||arenaLooks.exchange,[floorColor,wallColor,trimColor,skyColor,groundColor,fogDensity,metal]=look;
    this.scene.fog.density=fogDensity;world.userData.look=arena.id;
    for(const light of this.scene.children){if(light.isHemisphereLight){light.color.set(skyColor);light.groundColor.set(groundColor);light.intensity=arena.terrain?2.5:1.8;}if(light.isDirectionalLight){light.color.set(skyColor);light.intensity=arena.terrain?3.1:2.4;light.position.set(arena.id==='aether'?-18:18,24,arena.id==='foundry'?-12:10);}}
    const floor=material(arena.floorColor??floorColor,metal,.78),wall=material(wallColor,metal,.72),trim=material(trimColor,metal,.58),glow=material(arena.color,.4,.3,true),islands=arena.platforms?.length>0;
    const palette=[floor,wall,trim,glow],detailBatches=new Map(),indexedUnit=new T.BoxGeometry(1,1,1),unit=indexedUnit.toNonIndexed();indexedUnit.dispose();
    const arenaSeed=arenaSeedOf(arena),textured=this.renderer?.isSoftware!==true&&typeof document!=='undefined'&&!this.reduced();
    clearSurfaceTextures();
    const applyTextures=(mat,kind,rx,ry)=>{if(!textured)return mat;const maps=surfaceTextures(kind,{seed:arenaSeed,repeat:[rx,ry]});if(maps){mat.map=maps.map;mat.roughnessMap=maps.roughnessMap;mat.normalMap=maps.normalMap;mat.normalScale=new T.Vector2(.4,.4);}return mat;};
    const variantBuckets={block:new Map(),detail:new Map(),terrain:new Map(),terrainWall:new Map()};
    const variant=(scope,base,{map=false,kind='rock'}={})=>{const bucket=variantBuckets[scope];let clone=bucket.get(base);if(!clone){clone=base.clone();clone.vertexColors=true;clone.map=null;clone.normalMap=null;clone.roughnessMap=null;if(map)applyTextures(clone,kind,1,1);bucket.set(base,clone);palette.push(clone);}return clone;};
    applyTextures(floor,'concrete',Math.max(2,Math.round(width/4)),Math.max(2,Math.round(depth/4)));
    // Shadow camera fits the arena half-extent; the arena ground color keeps shadowed surfaces tinted.
    if(this.sun){const centerX=(minX+maxX)/2,centerZ=(minZ+maxZ)/2,extent=Math.max(width,depth)/2+10;this.sunTarget.position.set(centerX,0,centerZ);this.sun.position.set(centerX+(arena.id==='aether'?-18:18),26,centerZ+(arena.id==='foundry'?-12:12));if(this.sun.shadow){const shadowCamera=this.sun.shadow.camera;shadowCamera.left=-extent;shadowCamera.right=extent;shadowCamera.top=extent;shadowCamera.bottom=-extent;shadowCamera.near=.5;shadowCamera.far=extent*4+80;shadowCamera.updateProjectionMatrix();this.sun.shadow.bias=-.0006;this.sun.shadow.normalBias=.03;}}
    // Bake shallow cladding into a handful of ordinary meshes, not hundreds of draw calls.
    const detail=(w,h,d,x,y,z,rawMat)=>{if(Math.min(w,h,d)<=0)return;const mat=variant('detail',rawMat);let entry=detailBatches.get(mat);if(!entry){entry={positions:[]};detailBatches.set(mat,entry);}const p=unit.attributes.position,positions=entry.positions;for(let i=0;i<p.count;i++)positions.push(x+p.getX(i)*w,y+p.getY(i)*h,z+p.getZ(i)*d);};
   if(!islands&&!arena.terrain){
   // Subdivide the floor: smaller surfaces also improve the software renderer's depth ordering.
    const tile=5;for(let x=minX+tile/2;x<maxX;x+=tile)for(let z=minZ+tile/2;z<maxZ;z+=tile){const tileMesh=box(world,Math.min(tile,maxX-x+tile/2),.5,Math.min(tile,maxZ-z+tile/2),x,-.25,z,floor);tileMesh.receiveShadow=true;}
   const grid=new T.GridHelper(legacy?28:Math.max(width,depth),legacy?14:Math.max(1,Math.round(Math.max(width,depth)/2)),arena.color,'#304752');grid.position.set((minX+maxX)/2,.006,(minZ+maxZ)/2);world.add(grid);
   }else if(islands){
    const voidMat=material(arena.background,.1,.9),platformMat=floor,routeMats={north:material('#d5a45c',.35,.35,true),middle:glow,south:material('#b28cff',.35,.35,true)},supportMat=wall;
    palette.push(voidMat,...Object.values(routeMats));
   box(world,width+70,.25,depth+70,(minX+maxX)/2,(arena.voidY??-8)-3,(minZ+maxZ)/2,voidMat);
    for(const p of arena.platforms){const y=p.y??p.topY??0,thickness=p.thickness??.7,mat=routeMats[p.route]||glow;const deck=box(world,p.w,thickness,p.d,p.x,y-thickness/2,p.z,platformMat);deck.userData.platform=true;
     for(const sign of [-1,1]){detail(p.w-.2,.018,.07,p.x,y+.01,p.z+sign*(p.d/2-.14),mat);detail(.07,.018,p.d-.2,p.x+sign*(p.w/2-.14),y+.01,p.z,mat);}
     for(let x=-p.w/2+2;x<p.w/2;x+=4)detail(.035,.012,p.d-.5,p.x+x,y+.008,p.z,trim);
     // Underside silhouettes stay inside each island footprint and below the landing plane.
     if(arena.id==='aether'){const keel=cylinder(world,Math.min(p.w,p.d)*.42,.35,2.6,p.x,y-thickness-1.3,p.z,supportMat,6);keel.userData.underside=true;ring(world,Math.min(p.w,p.d)*.32,.045,p.x,y-thickness-.3,p.z,mat);}
     else if(arena.id==='longreach-plateau'){for(let tier=0;tier<3;tier++)detail(p.w*(1-tier*.16),.8,p.d*(1-tier*.16),p.x,y-thickness-.4-tier*.8,p.z,tier%2?trim:wall);}
     else{for(const sign of [-1,1]){detail(p.w-.4,.4,.28,p.x,y-thickness-.2,p.z+sign*p.d*.32,trim);detail(.35,arena.id==='ironfall-megastructure'?3:1.6,p.d*.7,p.x+sign*p.w*.3,y-thickness-(arena.id==='ironfall-megastructure'?1.5:.8),p.z,supportMat);}}
    }
   for(const landmark of arena.landmarks||[])textLabel(world,landmark.label,landmark.x,landmark.y??3,landmark.z,.55,arena.color);
   }
   if(arena.terrain){
      const terrainMaterials={grass:floor,dirt:material(arena.id==='blood-gulch'?'#a18b60':'#b88b5e',.02,.96),rock:wall,cliff:material(arena.id==='blood-gulch'?'#867b63':'#986e50',.03,.95),sand:material('#c8ad72',.02,.97),snow:material('#dfeaf2',.02,.9),ice:material('#bcd8e8',.1,.25),ash:material('#4a4038',.05,.95),stone:material('#8a8378',.04,.9),concrete:material('#8d9298',.05,.85),metal:material('#6b737a',.6,.5),lava:material('#ff7a3c',.1,.6,true)};
     palette.push(...Object.values(terrainMaterials));
    const addTerrainMesh=(triangles,side=false)=>{const scope=side?'terrainWall':'terrain',groups=new Map();for(const triangle of triangles){const key=triangle.material||'rock';const group=groups.get(key)||{positions:[],uvs:[]};const normal=triangle.normal,ax=Math.abs(normal[0]),ay=Math.abs(normal[1]),az=Math.abs(normal[2]);for(const point of triangle.vertices){group.positions.push(point[0],point[1],point[2]);if(ay>=ax&&ay>=az)group.uvs.push(point[0]*.22,point[2]*.22);else if(ax>=az)group.uvs.push(point[2]*.22,point[1]*.22);else group.uvs.push(point[0]*.22,point[1]*.22);}groups.set(key,group);}for(const [key,group] of groups){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(group.positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(group.uvs,2));geometry.computeVertexNormals();paintGeometry(geometry,arenaSeed+key.length*37,.2);const mat=variant(scope,terrainMaterials[key]||terrainMaterials.rock,{map:textured,kind:terrainTextureKind(key)});if(side&&mat.side!==T.DoubleSide)mat.side=T.DoubleSide;const mesh=new T.Mesh(geometry,mat);mesh.userData.terrain=true;mesh.castShadow=true;mesh.receiveShadow=true;world.add(mesh);}}
     addTerrainMesh(terrainTriangles(arena.terrain));addTerrainMesh(terrainWallTriangles(arena.terrain),true);
     // Intersect the actual cliff triangles with horizontal strata; never invent cliff walls.
           const strata=[];for(const {vertices} of [...terrainWallTriangles(arena.terrain),...terrainTriangles(arena.terrain).filter(tri=>tri.walkable===false)]){const low=Math.min(...vertices.map(p=>p[1])),high=Math.max(...vertices.map(p=>p[1]));for(let y=Math.ceil(low/1.6)*1.6;y<high;y+=1.6){const hits=[];for(let i=0;i<3;i++){const a=vertices[i],b=vertices[(i+1)%3];if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y)){const t=(y-a[1])/(b[1]-a[1]);hits.push([a[0]+t*(b[0]-a[0]),y,a[2]+t*(b[2]-a[2])]);}}if(hits.length===2)strata.push(...hits[0],...hits[1]);}}
     if(strata.length){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(strata,3));const lines=new T.LineSegments(geometry,new T.LineBasicMaterial({color:trimColor,transparent:true,opacity:.45,depthWrite:false}));lines.userData.strata=true;world.add(lines);terrainMaterials.cliff.polygonOffset=true;terrainMaterials.cliff.polygonOffsetFactor=1;terrainMaterials.cliff.polygonOffsetUnits=1;}
    }
  const rockMat=applyTextures(material('#827d67',.02,.98),'rock',2,2),teamMats=TEAM_PALETTE.map(team=>material(team.color,.15,.8));
  palette.push(rockMat,...teamMats);
  const raceMats=arena.race?{'race-rail':material('#e78b30',.08,.78),'race-infield':material('#203b30',.02,.96),'race-apron':material('#171e28',.02,.94),'soccer-wall':material('#2b3550',.12,.82),'soccer-goal':material('#eef2f6',.35,.4),stripe:material('#f4eddb',.05,.85)}:null;
  if(raceMats)palette.push(...Object.values(raceMats));
  for(const [index,b] of arena.blocks.entries()){
   const rock=arena.id==='blood-gulch'&&(['cover','landmark','rock','boulder'].includes(b.kind)),bunker=b.kind?.startsWith('base-')||b.kind==='cliff-outpost',raceMat=raceMats?.[b.kind],blockMat=variant('block',raceMat??(rock?rockMat:wall),{map:textured&&!raceMat,kind:rock?'rock':'metal'}),body=box(world,b.w,b.h,b.d,b.x,b.h/2,b.z,blockMat);paintGeometry(body.geometry,arenaSeed+index*13+1,.16);body.userData.block=index;body.castShadow=true;body.receiveShadow=true;
    // Rails are continuous collision runs of overlapping boxes; render the
    // smooth barrier walls in raceTrackModel instead so they never z-fight.
    if(raceMat){if(b.kind==='race-rail'||b.kind==='soccer-goal'){body.visible=false;body.castShadow=false;body.receiveShadow=false;}continue;}
   // Next-gen maps keep these as invisible collision proxies and draw smooth geometry in buildNextGen.
   if(arena.nextGen===true&&NEXTGEN_PROXY.has(b.kind)){body.visible=false;continue;}
   // Keep the complete collision box visible: rock fractures and armor are surface treatments.
   if(rock){const positions=[];for(const sign of [-1,1])for(let row=1;row<=3;row++){const y=b.h*row/4;positions.push(b.x-b.w/2,y,b.z+sign*(b.d/2+.006),b.x+b.w/2,y+.12,b.z+sign*(b.d/2+.006));positions.push(b.x+sign*(b.w/2+.006),y,b.z-b.d/2,b.x+sign*(b.w/2+.006),y-.08,b.z+b.d/2);}const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));const fractures=new T.LineSegments(geometry,new T.LineBasicMaterial({color:'#514e40'}));fractures.userData.rockDetail=true;world.add(fractures);detail(b.w*.72,.014,b.d*.68,b.x,b.h+.008,b.z,trim);continue;}
   const accent=bunker?teamMats[b.x<0?0:1]:glow;
   for(const sign of [-1,1]){
    detail(b.w,.06,.022,b.x,b.h-.12,b.z+sign*(b.d/2+.012),bunker?trim:accent);
    detail(.022,.06,b.d,b.x+sign*(b.w/2+.012),b.h-.12,b.z,bunker?trim:accent);
    if(b.kind==='rampwall')continue;
    const count=Math.max(1,Math.min(10,Math.floor(b.w/2)));for(let i=0;i<count;i++){const x=b.x-b.w/2+(i+.5)*b.w/count;
     detail(Math.min(1.3,b.w/count*.72),b.h*.42,.024,x,b.h*.48,b.z+sign*(b.d/2+.014),trim);
     detail(Math.min(.8,b.w/count*.5),.065,.028,x,b.h*.65,b.z+sign*(b.d/2+.028),accent);
     if(arena.id==='foundry'||arena.id==='ironfall-megastructure')for(let row=0;row<3;row++)detail(Math.min(1,b.w/count*.6),.045,.032,x,b.h*.38+row*.16,b.z+sign*(b.d/2+.03),wall);
    }
    for(const x of [-1,1])detail(Math.min(.14,b.w*.1),b.h*.85,.025,b.x+x*(b.w/2-Math.min(.12,b.w*.15)),b.h*.48,b.z+sign*(b.d/2+.015),trim);
   }
   if(bunker){detail(b.w*.65,.015,b.d*.65,b.x,b.h+.009,b.z,trim);detail(b.w*.5,.016,.16,b.x,b.h+.018,b.z,accent);}
   if(b.kind==='reactor'){for(const sign of [-1,1])for(let row=0;row<5;row++)detail(.04,b.h*.1,b.d*.66,b.x+sign*(b.w/2+.025),b.h*(.18+row*.15),b.z,arena.id==='citadel'?trim:glow);}
   if(arena.id==='citadel'&&b.kind==='wall')for(let x=-b.w/2+.4;x<b.w/2;x+=1.6)detail(.65,.35,b.d*.8,b.x+x,b.h-.175,b.z,trim);
  }
  if(arena.ceilings?.length){const ceilMat=variant('block',wall,{map:textured,kind:'metal'});for(const [index,c] of arena.ceilings.entries()){const ceiling=box(world,c.w,c.h??.6,c.d,c.x,c.y??6,c.z,ceilMat);ceiling.userData.ceiling=index;ceiling.receiveShadow=true;}}
  // Runway paint and inset floor seams do not read as obstacles or bridge void gaps.
  if(!islands&&!arena.terrain){for(let x=minX+2;x<maxX;x+=4)for(let z=minZ+2;z<maxZ;z+=4)detail(1.2,.012,.035,x,.012,z,trim);
   if(arena.id==='launchpad')for(let x=minX+3;x<maxX-2;x+=3)for(const sign of [-1,1])detail(1.5,.016,.22,x,.024,sign*10,glow);
  }
   for(const [mat,entry] of detailBatches){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(entry.positions,3));geometry.computeVertexNormals();paintGeometry(geometry,arenaSeed+77,.14);const mesh=new T.Mesh(geometry,mat);mesh.userData.arenaDetail=true;mesh.receiveShadow=true;world.add(mesh);}unit.dispose();
 if(arena.raised){for(const x of [-11.05,11.05]){const length=Math.hypot(12,3.8),ramp=box(world,5.5,.18,length,x,1.83,-3,floor);ramp.rotation.x=Math.atan(3.8/12);for(const sx of [-2.2,2.2]){const strip=box(world,.06,.04,length,x+sx,1.96,-3,glow);strip.rotation.x=Math.atan(3.8/12);}}box(world,27,.06,.07,0,3.84,-9,glow);}
 if(arena.id==='crosswire'){for(const x of [-1.6,1.6])box(world,.055,.03,26,x,.04,0,glow);for(const z of [-1.6,1.6])box(world,26,.03,.055,0,.04,z,glow);ring(world,2,.025,0,6.2,0,glow);}
 if(arena.id==='exchange')for(const y of [.25,3.5,5.5])ring(world,2.1,.055,0,y,0,glow);
 if(arena.id==='foundry')for(const x of [-4,4]){for(const z of [-2,0,2])box(world,1.8,.03,.35,x,5.77,z,glow);textLabel(world,'HOT',x,4,2.52,.35,'#ffc684');}
    if(!islands&&!arena.terrain){const edge=legacy?13.94:maxX-.06;textLabel(world,arena.name.toUpperCase(),(minX+maxX)/2,6.5,minZ+.06,1.3);textLabel(world,'02',minX+.06,5.8,(minZ+maxZ)/2,1.2,arena.color,Math.PI/2);textLabel(world,'01',maxX-.06,5.8,(minZ+maxZ)/2,1.2,arena.color,-Math.PI/2);for(const x of legacy?[-7,7]:[(minX+maxX)/2-width*.25,(minX+maxX)/2+width])box(world,.07,.04,depth*.77,x,.06,(minZ+maxZ)/2,glow);for(const z of legacy?[-10,0,10]:[minZ+depth/6,(minZ+maxZ)/2,maxZ-depth/6]){box(world,width,.3,.35,(minX+maxX)/2,8.5,z,trim);box(world,width*.72,.05,.15,(minX+maxX)/2,8.32,z,glow);}for(const x of legacy?[-12,12]:[minX+2,maxX-2]){const light=new T.PointLight(arena.color,28,15,2);light.position.set(x,5,(minZ+maxZ)/2);world.add(light);}}
    this.raceModels=new Map();
    if(arena.race)raceTrackModel(arena.race,arena.color,world);
    this.buildNextGen(world,arena);
   this.addTraversal(world,arena,glow);
   // Unused family colors never reach the scene's normal disposal traversal.
   const usedMaterials=new Set();world.traverse(n=>{if(n.material)usedMaterials.add(n.material);});for(const mat of new Set(palette))if(!usedMaterials.has(mat))mat.dispose();
   if(this.renderer?.isSoftware!==true){addSky(world,{background:arena.background,radius:185});addMountains(world,{background:arena.background,seed:arenaSeed,radius:150,count:26,base:-12});if(arena.terrain)addScatter(world,{terrain:arena.terrain,bounds,seed:arenaSeed});}
   if(this.renderer?.shadowMap)this.renderer.shadowMap.needsUpdate=true;
  }
    addTraversal(world,arena,glow){const pads=[...traversalItems(arena,'trampolines'),...traversalItems(arena,'jumpPads'),...traversalItems(arena,'pads')],launchers=[...traversalItems(arena,'boostLaunchers'),...traversalItems(arena,'launchers')],links=arena.jumpLinks||[];const shared=this.renderResources??=new Set(),padGeo=new T.CylinderGeometry(.7,.7,.12,16),padMat=material(arena.color,.25,.25,true),launchGeo=new T.BoxGeometry(.8,.1,1.3),launchMat=material(arena.color,.25,.25,true);shared.add(padGeo).add(padMat).add(launchGeo).add(launchMat);for(const raw of pads){const p=pointOf(raw),y=p.y??0,m=new T.Mesh(padGeo,padMat);m.position.set(p.x,y+.06,p.z);m.userData.traversal='trampoline';world.add(m);ring(world,.78,.035,p.x,y+.13,p.z,padMat); }for(const raw of launchers){const p=pointOf(raw),y=p.y??0,m=new T.Mesh(launchGeo,launchMat),id=raw.id??raw.traversal??raw.traversalId??raw.traversalID,link=links.find(item=>(item.traversal??item.traversalId??item.traversalID)===id),from=link&&pointOf(link.source),to=link&&pointOf(link.target);m.position.set(p.x,y+.05,p.z);m.rotation.y=from&&to?Math.atan2(to.x-from.x,to.z-from.z):raw.rotation??raw.yaw??(Array.isArray(raw.dir)?Math.atan2(raw.dir[0],raw.dir[1]):0);m.userData.traversal='boost-launcher';world.add(m);m.userData.stripes=[-.25,.25].map(x=>box(m,.06,.04,.9,x,.08,0,glow));}for(const link of links){const from=pointOf(link.source),to=pointOf(link.target),mid=V((from.x+to.x)/2,Math.max(from.y??0,to.y??0)+4,(from.z+to.z)/2),geo=new T.BufferGeometry().setFromPoints([V(from.x,(from.y??0)+.14,from.z),mid,V(to.x,(to.y??0)+.14,to.z)]),arc=new T.Line(geo,glow);arc.userData.traversal='jump-link';world.add(arc);}const teleporters=traversalItems(arena,'teleporters');if(teleporters.length){const padGeo2=new T.CylinderGeometry(.9,.9,.16,20),padMat2=material(arena.color,.3,.25,true);shared.add(padGeo2).add(padMat2);for(const raw of teleporters){const p=pointOf(raw),y=p.y??0,m=new T.Mesh(padGeo2,padMat2);m.position.set(p.x,y+.08,p.z);m.userData.traversal='teleporter';world.add(m);ring(world,1,.04,p.x,y+.16,p.z,padMat2);ring(world,1.35,.03,p.x,y+.16,p.z,padMat2);}}const ziplines=traversalItems(arena,'ziplines');if(ziplines.length){const cableMat=material(arena.color,.6,.3,true),anchorMat=material('#c9d6dd',.85,.3);shared.add(cableMat).add(anchorMat);for(const raw of ziplines){const from=pointOf(raw.from??raw.a),to=pointOf(raw.to??raw.b),ay=(from.y??0)+2.4,by=(to.y??0)+2.4,cable=tube(world,from.x,ay,from.z,to.x,by,to.z,.035,cableMat,5);cable.userData.traversal='zipline';for(const anchor of [[from.x,ay,from.z],[to.x,by,to.z]]){const post=cylinder(world,.07,.09,2.4,anchor[0],anchor[1]-1.2,anchor[2],anchorMat,8);post.userData.traversal='zipline';}ring(world,.22,.03,from.x,ay,from.z,cableMat,0);ring(world,.22,.03,to.x,by,to.z,cableMat,0);}}}
 // Smooth geometry for next-gen maps: roofs, arches, columns, tunnels, cavern
 // domes and organic props replace the raw collision boxes (which are hidden).
 buildNextGen(world,arena){
  const structures=arena.structures||[],props=arena.props||[];
  if(!structures.length&&!props.length)return;
  const shared=this.renderResources??=new Set(),cache=new Map();
  const geo=(key,make)=>{let g=cache.get(key);if(!g){g=make();cache.set(key,g);shared.add(g);}return g;};
  const wallMat=material(arena.color,.35,.5,false),stone=material('#8a8378',.05,.92),wood=material('#6b4a2f',.1,.85),leaf=material('#4f8f4a',.15,.85),metal=material('#6b737a',.65,.45),barrel=material('#b0703f',.35,.6),dark=material('#20262b',.5,.55),glass=material('#8fd8ff',.2,.15,true),tunnelMat=material('#7c756a',.04,.94),caveMat=material('#6a6258',.03,.96);tunnelMat.side=T.DoubleSide;caveMat.side=T.DoubleSide;
  const hash3=(x,y,z,s)=>{let h=Math.imul(Math.round(x*13)+1,374761393)^Math.imul(Math.round(y*13)+7,668265263)^Math.imul(Math.round(z*13)+3,s|0);h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967295;};
  const mesh=(g,m,x,y,z,rx=0,ry=0,rz=0)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.castShadow=true;o.receiveShadow=true;world.add(o);return o;};
  for(const s of structures){
   if(s.type==='building'){
    const q=((Math.round(s.rot/(Math.PI/2))%4)+4)%4,sw=q%2?s.d:s.w,sd=q%2?s.w:s.d;
    if(s.roof==='gable'){const rh=Math.min(3.2,Math.max(1.6,Math.min(sw,sd)*.36)),g=geo(`gable|${sw.toFixed(1)}|${sd.toFixed(1)}|${rh.toFixed(1)}`,()=>{const shape=new T.Shape();shape.moveTo(-sw/2,0);shape.lineTo(sw/2,0);shape.lineTo(0,rh);shape.closePath();const e=new T.ExtrudeGeometry(shape,{depth:sd,bevelEnabled:false});e.translate(0,0,-sd/2);return e;});mesh(g,wallMat,s.x,s.y+s.h,s.z);}
    else{const g=geo(`flat|${sw.toFixed(1)}|${sd.toFixed(1)}`,()=>new T.BoxGeometry(sw+.5,.42,sd+.5));mesh(g,dark,s.x,s.y+s.h+.2,s.z);}
   }else if(s.type==='windows'){
    const alongX=Math.abs(Math.sin(s.rot))<.5,rows=Math.max(1,s.rows),count=Math.max(2,Math.floor(s.w/3.2)),gx=geo('win-x',()=>new T.BoxGeometry(1.5,1,.14)),gz=geo('win-z',()=>new T.BoxGeometry(.14,1,1.5));
    for(let r=0;r<rows;r++)for(let i=0;i<count;i++){const off=(i/(count-1||1)-.5)*s.w,px=alongX?s.x+off:s.x,pz=alongX?s.z:s.z+off;mesh(alongX?gx:gz,glass,px,s.y+r*1.7,pz);}
   }else if(s.type==='arch'){
    const half=Math.max(1.5,s.width/2),th=.35,h=s.height??5,g=geo(`arch|${half.toFixed(1)}`,()=>new T.TorusGeometry(half,th,8,22,Math.PI)),cg=geo(`acol|${th}`,()=>new T.CylinderGeometry(th,th,h,10));
    mesh(g,wallMat,s.x,s.y+h,s.z,0,s.rot,0);
    for(const side of[-1,1])mesh(cg,wallMat,s.x+Math.cos(s.rot)*half*side,s.y+h/2,s.z-Math.sin(s.rot)*half*side);
   }else if(s.type==='column'){
    const r=s.radius??.6,h=s.height??5,g=geo(`col|${r.toFixed(2)}|${h.toFixed(1)}`,()=>new T.CylinderGeometry(r,r,h,12)),cap=geo(`cap|${r.toFixed(2)}`,()=>new T.CylinderGeometry(r*1.35,r*1.35,.28,12));
    mesh(g,stone,s.x,(s.y??0)+h/2,s.z);mesh(cap,stone,s.x,(s.y??0)+h-.14,s.z);mesh(cap,stone,s.x,(s.y??0)+.14,s.z);
   }else if(s.type==='tunnel'){
    const r=s.radius??3,caverns=structures.filter(c=>c.type==='cavern'),raw=s.points;
    const groundAt=(x,z)=>{const h=arena.terrain?.height?arena.terrain.height(x,z):null;return Number.isFinite(h)?h:null;};
    const trimmed=raw.map((p,i)=>{const neighbor=i===0?raw[1]:i===raw.length-1?raw[raw.length-2]:null;if(!neighbor)return p;const c=caverns.find(c=>Math.hypot(c.x-p[0],c.z-p[2])<1.5);if(!c)return p;const dx=neighbor[0]-p[0],dz=neighbor[2]-p[2],len=Math.hypot(dx,dz)||1,trim=Math.min(c.radius??12,len*.9);return [p[0]+dx/len*trim,p[1],p[2]+dz/len*trim];});
    // An open arch that follows the terrain, rather than a tube half-buried in it:
    // buried double-sided tubes z-fight along their length and poke through the domes.
    const path=[];
    for(let i=0;i<trimmed.length-1;i++){const a=trimmed[i],b=trimmed[i+1],len=Math.hypot(b[0]-a[0],b[2]-a[2]),n=Math.max(1,Math.ceil(len/5));for(let k=0;k<=n;k++){if(i>0&&k===0)continue;const t=k/n,x=a[0]+(b[0]-a[0])*t,z=a[2]+(b[2]-a[2])*t,g=groundAt(x,z);path.push({x,z,y:Number.isFinite(g)?g:(a[1]+(b[1]-a[1])*t)-1.2});}}
    const R=Math.max(.5,r*.95),ring=8,verts=[],idx=[];
    const tangent=i=>{const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)];const tx=b.x-a.x,tz=b.z-a.z,l=Math.hypot(tx,tz)||1;return {x:tx/l,z:tz/l};};
    for(let i=0;i<path.length;i++){const p=path[i],t=tangent(i),sx=-t.z,sz=t.x;for(let j=0;j<=ring;j++){const a=Math.PI*j/ring;verts.push(p.x+sx*R*Math.cos(a),p.y+R*Math.sin(a),p.z+sz*R*Math.cos(a));}}
    for(let i=0;i<path.length-1;i++)for(let j=0;j<ring;j++){const a=i*(ring+1)+j,b=a+1,c=a+ring+1,d=c+1;idx.push(a,c,d,a,d,b);}
    const key=`tun|${r}|${trimmed.map(p=>p.map(n=>Math.round(n)).join('.')).join('_')}`;
    const g=path.length>1?geo(key,()=>{const bg=new T.BufferGeometry();bg.setAttribute('position',new T.Float32BufferAttribute(verts,3));bg.setIndex(idx);bg.computeVertexNormals();return bg;}):null;
    if(g){const m=mesh(g,tunnelMat,0,0,0);m.castShadow=false;}
   }else if(s.type==='cavern'){
    const shell=cavernShell(s.radius??12,s.height??8),base=s.y??0,dome=geo(`cavdome|${shell.radius}`,()=>new T.SphereGeometry(shell.radius,28,12,0,Math.PI*2,0,Math.PI/2));
    for(const arc of shell.renderArcs){const key=`cavarc|${shell.radius}|${arc.thetaStart.toFixed(3)}|${arc.thetaLength.toFixed(3)}`,wg=geo(key,()=>new T.CylinderGeometry(shell.radius,shell.radius,1,28,1,true,arc.thetaStart,arc.thetaLength));const m=mesh(wg,caveMat,s.x,base+shell.wallHeight/2,s.z);m.scale.set(1,shell.wallHeight,1);}
    const roof=mesh(dome,caveMat,s.x,base+shell.wallHeight,s.z);roof.scale.set(1,shell.domeHeight/shell.radius,1);
   }else if(s.type==='bridge'){
    const q=((Math.round((s.rot||0)/(Math.PI/2))%4)+4)%4,along=q%2?'z':'x',len=q%2?(s.d??s.w):(s.w??s.d),wid=q%2?(s.w??s.d):(s.d??s.w),rail=gx=>geo(gx,()=>(gx==='rail-x'?new T.BoxGeometry(1,.12,.12):new T.BoxGeometry(.12,.12,1)));
    for(const side of[-1,1]){const m=mesh(along==='x'?rail('rail-x'):rail('rail-z'),metal,s.x,s.y+(s.thickness??.5)+.45,s.z+(along==='x'?side*(wid/2-.1):0));m.rotation.y=(s.rot||0);m.scale.set(along==='x'?len:1,1,along==='x'?1:len);}
   }
  }
  if(props.length){
   // Batch the repeated organic props into instanced meshes: one draw call per
   // prop family instead of one per rock/tree/crate.
   const groups={rock:[],tree:[],crate:[],barrel:[]},ruins=[];
   for(const p of props){if(groups[p.type])groups[p.type].push(p);else ruins.push(p);}
   const instance=(geometry,mat,list,place)=>{if(!list.length)return null;const inst=new T.InstancedMesh(geometry,mat,list.length);inst.castShadow=true;inst.receiveShadow=true;const m=new T.Object3D();list.forEach((p,i)=>{place(p,m);m.updateMatrix();inst.setMatrixAt(i,m.matrix);});inst.instanceMatrix.needsUpdate=true;world.add(inst);return inst;};
   instance(geo('prop-rock',()=>{const g0=new T.IcosahedronGeometry(1,1),pos=g0.attributes.position;for(let i=0;i<pos.count;i++){const nx=pos.getX(i),ny=pos.getY(i),nz=pos.getZ(i),n=.72+.55*hash3(nx,ny,nz,7);pos.setXYZ(i,nx*n,ny*n*.82,nz*n);}g0.computeVertexNormals();paintGeometry(g0,7,.22);return g0;}),stone,groups.rock,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+s*.42,p.z);m.rotation.set(0,(p.seed??0)*.7,0);m.scale.setScalar(s);});
   instance(geo('prop-trunk',()=>new T.CylinderGeometry(.11,.17,1.7,8)),wood,groups.tree,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+.85*s,p.z);m.rotation.set(0,(p.seed??0)*.5,0);m.scale.setScalar(s);});
   instance(geo('prop-canopy',()=>new T.ConeGeometry(1.1,2.3,10)),leaf,groups.tree,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+2.15*s,p.z);m.rotation.set(0,(p.seed??0)*.5,0);m.scale.setScalar(s);});
   instance(geo('prop-crate',()=>new T.BoxGeometry(1.2,1.2,1.2)),wood,groups.crate,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+.6*s,p.z);m.rotation.set(0,(p.seed??0)*.4,0);m.scale.setScalar(s);});
   instance(geo('prop-barrel',()=>new T.CylinderGeometry(.5,.5,1.15,12)),barrel,groups.barrel,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+.58*s,p.z);m.scale.setScalar(s);});
   const ruinGeo=geo('ruinwall',()=>new T.BoxGeometry(2.6,2.4,.45));
   for(const p of ruins){const s=p.scale??1,seg=2+((p.seed??0)%3);for(let i=0;i<seg;i++){const a=(p.seed??0)*.7+i*1.05,m=mesh(ruinGeo,stone,p.x+Math.cos(a)*1.3*s,p.y+1.1*s,p.z+Math.sin(a)*1.3*s,(p.seed%7)*.05,a,0);m.scale.set(s,s*(.6+((p.seed+i)%3)*.22),s);}}
  }
  // Every terrain map should carry at least one batched detail layer (floor seams
  // and route marks) so the world reads with the same polish as the legacy maps.
  if(!world.children.some(n=>n.userData.arenaDetail)){
   const positions=[];
   for(let i=0;i<8;i++){const a=(i/8)*Math.PI*2,cx=Math.cos(a)*6,cz=Math.sin(a)*6,y=arena.terrain.height(cx,cz)+.03,r=1.1;
    positions.push(cx-r,y,cz-r,cx+r,y,cz-r,cx+r,y,cz+r,cx-r,y,cz-r,cx+r,y,cz+r,cx-r,y,cz+r);}
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.computeVertexNormals();paintGeometry(g,1,.12);
   const m=new T.Mesh(g,material(arena.color,.4,.5,true));m.userData.arenaDetail=true;m.receiveShadow=true;world.add(m);
  }
 }
 makeMenu(){const scene=new T.Scene();scene.background=new T.Color('#080f13');scene.fog=new T.FogExp2('#080f13',.055);const camera=new T.PerspectiveCamera(38,1,.1,80);camera.position.set(5,3.3,10);camera.lookAt(0,1.4,0);scene.add(new T.HemisphereLight('#bdedee','#233139',2.8));const key=new T.DirectionalLight('#e4fff3',4);key.position.set(-4,6,5);scene.add(key);const rim=new T.PointLight('#52e5cf',80,15);rim.position.set(3,3,-3);scene.add(rim);
 const dark=material('#152128',.8,.4),glow=material('#67e7d3',.4,.2,true);box(scene,50,.3,50,0,-.35,0,dark);const grid=new T.GridHelper(40,40,'#284443','#192c31');grid.position.y=-.19;scene.add(grid);cylinder(scene,1.55,1.8,.3,0,-.02,0,dark,48);ring(scene,1.57,.018,0,.15,0,glow);ring(scene,2.05,.014,0,-.16,0,glow);ring(scene,2.2,.01,0,-.16,0,glow);
 for(let i=-4;i<=4;i++){box(scene,.25,9,.5,i*3,4,-6,dark);box(scene,.045,6,.04,i*3+.18,4,-5.72,glow);}
 const model=robotModel('chatgpt');model.scale.setScalar(2.15);model.position.y=.17;model.rotation.y=.25;scene.add(model);return {scene,camera,model,id:'chatgpt'};}
 setCharacter(id){if(id===this.menu.id)return;this.disposeObject(this.menu.model);this.menu.scene.remove(this.menu.model);this.menu.model=robotModel(id);this.menu.model.scale.setScalar(2.15);this.menu.model.position.y=.17;this.menu.scene.add(this.menu.model);this.menu.id=id;}
      setMatch(match){const arena=match.arena||MAPS.find(a=>a.id===match.mapId)||MAPS[0];this.clearObjectiveMarkers();if(this.payloadModel){this.scene.remove(this.payloadModel);this.disposeObject(this.payloadModel);this.payloadModel=null;}for(const m of [...this.actorModels.values(),...this.pickupModels,...(this.flagModels||new Map()).values()]){this.scene.remove(m);this.disposeObject(m);}this.flagModels=new Map();if(this.mapId!==arena.id)this.buildArena(arena);const assets=this.modelAssets??=new ModelAssets();this.actorModels=new Map((match.actors||[]).map(a=>{const m=robotModel(a.character,assets);this.scene.add(m);return [a.id,m];}));this.pickupModels=(match.pickups||[]).map(p=>{const g=new T.Group(),colors={health:'#77efba',armor:'#6dbfff',rocket:'#ffb164',rail:'#bf9cff',scatter:'#ffde87',plasma:'#72cfff',grenade:'#ff806b',shock:'#8ce8ff',flak:'#ffd166',marksman:'#ffd27a',smg:'#8affc1',haste:'#72f1b8',overcharge:'#ff8f70',overshield:'#75baff',recon:'#7fe7ff',cloak:'#c8b6ff'},mat=material(colors[p.kind]||'#8ad9d3',.4,.3,true);if(p.kind==='health'){box(g,.6,.19,.19,0,.65,0,mat);box(g,.19,.6,.19,0,.65,0,mat);}else if(p.kind==='armor'){const m=new T.Mesh(new T.OctahedronGeometry(.4),mat);m.position.y=.7;g.add(m);}else if(['haste','overcharge','overshield'].includes(p.kind)){const m=new T.Mesh(new T.IcosahedronGeometry(.36,1),mat);m.position.y=.7;g.add(m);ring(g,.55,.022,0,.07,0,mat);}else{const w=weaponModel(pickupWeapon(p.kind),assets);w.position.y=.75;w.scale.setScalar(.7);g.add(w);}if(!['haste','overcharge','overshield'].includes(p.kind))ring(g,.55,.022,0,.07,0,mat);g.position.set(p.x||0,p.y||0,p.z||0);this.scene.add(g);return g;});this._trackAssets(assets);this.syncVehicles(match);this.updateFlags(match,arena);this.updateObjectives(match,arena);this.effectPool?.clear();this.projectilePool?.clear();this.railPool?.clear();this.deathContext?.clear();this.deathPool?.clear();this.feedback?.reset();this.cameraShake?.reset();this.lowHealth=false;this.flashUntil=0;this.lastEvent=match.serial||0;this.currentWeapon=-1;}
      syncActors(match){const actors=match?.actors||[];for(const actor of actors)if(!this.actorModels.has(actor.id)){const model=robotModel(actor.character,this.modelAssets??=new ModelAssets());applyActorTeam(model,actor.team,this.display?.teamPalette);this.scene.add(model);this.actorModels.set(actor.id,model);}const live=new Set(actors.map(actor=>actor.id));for(const [id,model] of this.actorModels)if(!live.has(id)){this.scene.remove(model);this.disposeObject(model);this.actorModels.delete(id);}}
      styleActor(model,actor,palette){applyActorTeam(model,actor.team,palette);const profile=actor?.npcProfile;if(!profile)return;const data=model.userData||{};if(data.base?.material?.color)data.base.material.color.set(profile.color);if(data.armor?.color)data.armor.color.set(profile.accent||profile.color);model.scale.setScalar(profile.scale??1);}
      updateWaypoint(match,arena){const waypoint=match?.waypoint;if(!waypoint){if(this.waypointModel){this.scene.remove(this.waypointModel);this.disposeObject(this.waypointModel);this.waypointModel=null;this.waypointId=null;}return;}if(!this.waypointModel||this.waypointId!==waypoint.id){if(this.waypointModel){this.scene.remove(this.waypointModel);this.disposeObject(this.waypointModel);}this.waypointId=waypoint.id;this.waypointModel=createObjectiveModel({id:'waypoint',x:waypoint.x,y:waypoint.y??0,z:waypoint.z,radius:waypoint.radius??4,label:waypoint.label},arena);this.scene.add(this.waypointModel);}else{this.waypointModel.position.set(waypoint.x,waypoint.y??0,waypoint.z);}}
   createFlagModel(team,arena){const resources=this.renderResources??=new Set(),color=this.objectiveColor(team,arena);const assets=this.flagAssets??={},poleGeo=assets.pole??=new T.CylinderGeometry(.035,.05,1.8,8),bannerGeo=assets.banner??=new T.BoxGeometry(.52,.32,.035),baseGeo=assets.base??=new T.CylinderGeometry(.34,.42,.08,16),mat=material(color,.35,.3,true);resources.add(poleGeo);resources.add(bannerGeo);resources.add(baseGeo);const g=new T.Group();const pole=new T.Mesh(poleGeo,mat);pole.position.y=.9;g.add(pole);const banner=new T.Mesh(bannerGeo,mat);banner.position.set(.24,1.55,0);g.add(banner);for(const z of [-.025,.025]){const mark=teamMark();mark.position.set(.24,1.55,z);updateTeamMark(mark,team);g.add(mark);}const base=new T.Mesh(baseGeo,mat);base.position.y=.04;g.add(base);g.userData={team,teamLabel:teamPresentation(team,this.display?.teamPalette)?.label??null,flag:true,banner,material:mat};return g;}
     updateFlags(match,arena=MAPS[0]){this.updateVehicleModels(match);const input=match?.flags;if(!input){for(const g of this.flagModels?.values()||[])g.visible=false;return;}const flags=Array.isArray(input)?input:Object.entries(input).map(([team,flag])=>({...flag,team:flag?.team??team}));const active=new Set();for(const flag of flags.slice(0,8)){if(!flag)continue;const team=flag.team??flag.teamId??flag.id??0,key=String(team);let g=this.flagModels.get(key);if(!g){g=this.createFlagModel(team,arena);this.flagModels.set(key,g);this.scene.add(g);}active.add(key);const carrier=flag.carrier??flag.carrierId??flag.carriedBy;g.visible=carrier==null&&flag.state!=='carried'&&flag.status!=='carried';const p=pointOf(flag);g.position.set(p.x||0,p.y||0,p.z||0);g.rotation.y=flag.yaw??0;const dropped=flag.dropped===true||flag.state==='dropped'||flag.status==='dropped';const pulse=dropped&&!this.reduced();g.scale.setScalar(pulse?1+Math.sin((match.time||0)*7)*.08:1);g.userData.banner.material.opacity=dropped?.75:1;g.userData.banner.material.transparent=true;const flagColor=this.objectiveColor(team,arena),flagMaterial=g.userData.material;if(flagMaterial){flagMaterial.color.set(flagColor);flagMaterial.emissive?.set(flagColor);g.userData.banner.material.color.set(flagColor);}}for(const [key,g] of this.flagModels)if(!active.has(key))g.visible=false;}
     objectiveColor(team,arena,neutral=NEUTRAL){return teamPresentation(team,this.display?.teamPalette)?.color??neutral;}
       createObjectiveModel(zone,arena){const radius=Math.max(.8,Number(zone.radius)||3.5),progressValue=Math.max(0,Math.min(100,Number(zone.progress)||0)),software=this.renderer?.isSoftware===true,g=new T.Group(),baseMat=material(this.objectiveColor(zone.owner,arena),.25,.3,true),areaMat=material(this.objectiveColor(zone.owner,arena),.15,.8,true),progressMat=material('#ffd166',.2,.25,true),beacon=cylinder(g,.09,.16,1.35,0,.68,0,baseMat,10),area=new T.Mesh(new T.CylinderGeometry(radius,radius,.035,32),areaMat),base=ring(g,radius,.11,0,.05,0,baseMat),progress=new T.Mesh(software?new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progressValue/100):new T.RingGeometry(radius-.2,radius+.2,32),progressMat),emblem=new T.Mesh(new T.CylinderGeometry(.34,.34,.08,8),progressMat);for(const mat of [baseMat,areaMat,progressMat]){mat.depthTest=false;mat.depthWrite=false;}area.position.y=.018;area.renderOrder=100;base.renderOrder=100;progress.rotation.x=-Math.PI/2;progress.position.y=.07;progress.renderOrder=100;emblem.position.y=.13;emblem.renderOrder=100;if(!software)progress.geometry.setDrawRange(0,0);g.add(area,progress,emblem);g.userData={objective:true,area,base,beacon,progress,emblem,areaMat,baseMat,progressMat,radius,identifier:String(zone.id??'zone')};g.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});return g;}
     clearObjectiveMarkers(){for(const g of this.objectiveModels?.values()||[]){this.worldGroup?.remove(g);this.disposeObject(g);}this.objectiveModels?.clear();}
     createPayloadModel(team,arena){
      const g=new T.Group(),color=this.objectiveColor(team,arena),skin=material('#f3b9c6',.15,.72),snoutMat=material('#e79aad',.15,.73),hoof=material('#2a2228',.3,.72),eyeMat=material('#171018',.2,.5),accent=material(color,.4,.3,true),glow=material(color,.35,.25,true);
      glow.depthWrite=false;
      const tag=o=>{o.userData.objective=true;o.userData.noCameraOcclusion=true;return o;};
      // Ellipsoid body 1.6 wide x 1.1 tall x 2.4 long, nose forward (+z).
      const body=tag(new T.Mesh(new T.SphereGeometry(.5,20,14),skin));body.scale.set(1.6,1.1,2.4);body.castShadow=true;body.receiveShadow=true;g.add(body);
      const snout=tag(cylinder(g,.26,.26,.36,0,.04,1.28,snoutMat,12));snout.rotation.x=Math.PI/2;
      tag(cylinder(g,.29,.29,.05,0,.04,1.47,accent,12)).rotation.x=Math.PI/2;
      for(const x of [-.3,.3]){const ear=tag(new T.Mesh(new T.ConeGeometry(.19,.34,7),skin));ear.position.set(x,.62,1.0);ear.rotation.x=-.35;ear.rotation.z=x<0?-.25:.25;g.add(ear);}
      for(const x of [-.28,.28]){const e=tag(new T.Mesh(new T.SphereGeometry(.07,10,8),eyeMat));e.position.set(x,.33,1.02);g.add(e);}
      const trotters=[];
      for(const x of [-.45,.45])for(const z of [-.7,.7]){const leg=tag(cylinder(g,.12,.11,.3,x,-.6,z,skin,8));leg.userData.baseZ=leg.rotation.z;trotters.push(leg);tag(cylinder(g,.13,.13,.06,x,-.75,z,hoof,8));}
      const wings=[];
      for(const x of [-.82,.82]){const wing=tag(new T.Mesh(new T.ConeGeometry(.42,1.1,4),accent));wing.scale.set(.22,1,1);wing.position.set(x,.24,-.15);wing.rotation.z=x<0?-.5:.5;wing.rotation.y=Math.PI/2;wing.userData.baseZ=wing.rotation.z;g.add(wing);wings.push(wing);}
      const ring=tag(new T.Mesh(new T.TorusGeometry(1.5,.09,8,36),glow));ring.rotation.x=Math.PI/2;ring.position.y=-1.18;ring.renderOrder=90;g.add(ring);
      const beacon=tag(cylinder(g,.07,.14,1.5,0,1.35,0,glow,10));g.add(beacon);
      const halo=tag(new T.Mesh(new T.TorusGeometry(.34,.05,8,24),glow));halo.rotation.x=Math.PI/2;halo.position.y=.9;g.add(halo);
      let question=null;
      if(typeof document!=='undefined'&&typeof document.createElement==='function'){question=textLabel(g,'?',0,2.35,0,.6,'#ffffff');question.userData.objective=true;question.userData.noCameraOcclusion=true;}
      g.userData={payload:true,body,snout,wings,trotters,beacon,halo,ring,accentMaterials:[accent,glow],question,lastPosition:null};
      return g;
     }
     updatePayloadModel(match,arena=MAPS[0],time=0){
      const objective=match?.objectives??match?.objectiveState,payload=objective?.kind==='payload'?(objective.payload??objective):null;
      if(!payload?.position){if(this.payloadModel)this.payloadModel.visible=false;return;}
      if(!this.payloadModel){this.payloadModel=this.createPayloadModel(objective.attacker??0,arena);this.scene.add(this.payloadModel);}
      const g=this.payloadModel,p=payload.position,reduced=this.reduced(),t=Number.isFinite(time)?time:0,bob=reduced?0:Math.sin(t*2.5)*.18;
      g.visible=true;
      g.position.set(p.x||0,(p.y||0)+1.35+bob,p.z||0);
      const tangent=payloadTangent(payload,g.userData.lastPosition);
      if(Number.isFinite(tangent))g.rotation.y=tangent;else if(Number.isFinite(payload.yaw))g.rotation.y=payload.yaw;
      g.userData.lastPosition={x:p.x||0,z:p.z||0};
      for(const wing of g.userData.wings||[]){if(wing.userData.baseZ===undefined)wing.userData.baseZ=wing.rotation.z;wing.rotation.z=wing.userData.baseZ+(reduced?0:Math.sin(t*6)*.55);}
      const color=payload.contested?'#ffd166':this.objectiveColor(objective.attacker??0,arena);
      for(const part of g.userData.accentMaterials||[]){part.color.set(color);part.emissive?.set(color);}
      const beacon=g.userData.beacon,halo=g.userData.halo;
      if(beacon)beacon.material.emissiveIntensity=reduced?1.2:1.2+.8*Math.sin(t*4);
      if(halo)halo.scale.setScalar(reduced?1:1+.08*Math.sin(t*4));
     }
        updateObjectives(match,arena=MAPS[0]){const input=match?.objectives??match?.objectiveState;if(!input||!['koth','domination','assault','payload'].includes(input.kind)){this.clearObjectiveMarkers();return;}this.objectiveModels??=new Map();const active=new Set(),reduced=this.reduced(),software=this.renderer?.isSoftware===true,assaultActive=input.kind==='assault'&&Number.isFinite(input.active)?input.active:-1;for(const [zoneIndex,zone] of (input.zones||[]).entries()){if(!zone)continue;const key=String(zone.id??active.size),p=pointOf(zone),owner=zone.contested?'contested':zone.owner,capture=zone.captureTeam??zone.owner,progress=Math.max(0,Math.min(100,Number(zone.progress)||0)),radius=Math.max(.8,Number(zone.radius)||3.5);let g=this.objectiveModels.get(key);if(!g){g=this.createObjectiveModel(zone,arena);this.objectiveModels.set(key,g);this.worldGroup?.add(g);}active.add(key);const color=zone.contested?'#ffd166':this.objectiveColor(owner,arena),progressColor=zone.contested?'#ffd166':this.objectiveColor(capture,arena);g.position.set(p.x||0,p.y||0,p.z||0);g.userData.baseMat.color.set(color);g.userData.baseMat.emissive.set(color);g.userData.areaMat.color.set(color);g.userData.areaMat.emissive.set(color);g.userData.beacon.material=g.userData.baseMat;g.userData.progressMat.color.set(progressColor);g.userData.progressMat.emissive.set(progressColor);g.userData.progressMat.opacity=progress>0?1:0;g.userData.progressMat.transparent=true;if(g.userData.radius!==radius){g.userData.area.geometry.dispose();g.userData.area.geometry=new T.CylinderGeometry(radius,radius,.035,32);g.userData.base.geometry.dispose();g.userData.base.geometry=new T.TorusGeometry(radius,.11,6,32);g.userData.progress.geometry.dispose();g.userData.progress.geometry=software?new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progress/100):new T.RingGeometry(radius-.2,radius+.2,32);if(!software)g.userData.progress.geometry.setDrawRange(0,Math.ceil(progress/100*32)*6);g.userData.radius=radius;}if(g.userData.progressValue!==progress){if(software){g.userData.progress.geometry.dispose();g.userData.progress.geometry=new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progress/100);}else g.userData.progress.geometry.setDrawRange(0,Math.ceil(progress/100*32)*6);g.userData.progressValue=progress;}g.userData.progress.visible=progress>0;g.userData.identifier=String(zone.id??'zone');g.userData.emblem.material=g.userData.progressMat;const sectorActive=input.kind==='assault'&&zoneIndex===assaultActive,sectorDim=input.kind==='assault'&&!sectorActive;g.userData.assaultActive=sectorActive;if(input.kind==='assault'){g.userData.areaMat.opacity=sectorDim?.16:1;g.userData.areaMat.transparent=true;g.userData.baseMat.opacity=sectorDim?.32:1;g.userData.baseMat.transparent=true;g.userData.areaMat.emissiveIntensity=sectorActive?2.4:sectorDim?.35:1.6;g.userData.baseMat.emissiveIntensity=sectorActive?2.6:sectorDim?.4:1.6;if(!g.userData.assaultLabel&&typeof document!=='undefined'&&typeof document.createElement==='function'){const assaultLabel=textLabel(g,String(zone.id??'sector').toUpperCase(),0,2.7,0,.5,sectorActive?'#ffffff':'#95a3ac');assaultLabel.userData.objective=true;assaultLabel.userData.noCameraOcclusion=true;g.userData.assaultLabel=assaultLabel;}if(g.userData.assaultLabel)g.userData.assaultLabel.visible=sectorActive;}g.scale.y=reduced?1:sectorActive?1.04+.1*Math.sin((match.time||0)*5):sectorDim?1:1+.06*Math.sin((match.time||0)*4+(zone.id?.length||0));}for(const [key,g] of this.objectiveModels)if(!active.has(key)){this.worldGroup?.remove(g);this.disposeObject(g);this.objectiveModels.delete(key);}}
     updateVehicleModels(match){const reduced=this.reduced(),now=typeof performance!=='undefined'?performance.now():0;for(const vehicle of match.vehicles||[]){const model=this.vehicleModels?.get(vehicle.id);if(!model)continue;const p=vehicle.position||vehicle,x=p.x??0,y=p.y??0,z=p.z??0,yaw=vehicle.yaw??vehicle.heading??0,health=vehicle.health??1,respawn=vehicle.respawnTimer??0;model.visible=health>0&&respawn<=0;model.position.set(x,y,z);model.rotation.y=yaw;model.rotation.z=vehicle.roll??0;model.rotation.x=vehicle.pitchBody??vehicle.pitch??0;const speed=Math.hypot(vehicle.vx??0,vehicle.vz??0),stamp=Number.isFinite(match.time)?match.time:now/1000,dt=Math.max(0,Math.min(.1,stamp-(model.userData.spinTime??stamp)));model.userData.spinTime=stamp;const odometer=(model.userData.odometer??0)+speed*dt;model.userData.odometer=odometer;for(const wheel of model.userData.wheels||[])wheel.rotation.x=odometer/.42;const turret=model.userData.turret;if(turret)turret.rotation.y=Number.isFinite(vehicle.turretYaw)?vehicle.turretYaw:0;const heat=vehicle.heat??0,flash=(model.userData.flashUntil??0)>now;for(const gun of model.userData.guns||[]){gun.mount.scale.setScalar(1+heat*.08);gun.flash.visible=!reduced&&flash;}}}
     syncVehicles(match){this.vehicleModels??=new Map();const assets=this.modelAssets??=new ModelAssets();const active=new Set((match.vehicles||[]).map(vehicle=>vehicle.id));for(const [id,model] of this.vehicleModels)if(!active.has(id)){this.scene.remove(model);this.disposeObject(model);this.vehicleModels.delete(id);}for(const vehicle of match.vehicles||[]){if(this.vehicleModels.has(vehicle.id))continue;const model=vehicleModel(vehicle.kind,assets);this.vehicleModels.set(vehicle.id,model);this.scene.add(model);}this._trackAssets(assets);}
    _trackAssets(assets=this.modelAssets){if(!assets)return;const shared=this.sharedResources??=new Set();for(const resource of assets.resources)shared.add(resource);}
    disposeObject(o){if(!o?.traverse)return;const shared=this.renderResources,modelShared=this.sharedResources,geometries=new Set(),materials=new Set(),textures=new Set();o.traverse(n=>{if(n.geometry&&!shared?.has(n.geometry)&&!modelShared?.has(n.geometry))geometries.add(n.geometry);if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])if(!shared?.has(m)&&!modelShared?.has(m)){materials.add(m);for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap','bumpMap','displacementMap','envMap','lightMap','specularMap','gradientMap'])if(m[key]&&!m[key].userData?.surfaceKind)textures.add(m[key]);}});for(const r of [...geometries,...materials,...textures])r.dispose();}
   effect(e){if(!e)return;this.effectPool??=new EffectPool(this.scene);this.feedback??=new WeaponFeedback();const reduced=this.reduced(),info=weaponInfo(e.weapon??0);
  if(e.type==='death')this.spawnDeath(e,reduced);
     const actorModel=this.actorModels?.get(e.actor);
     if(!e.pos&&(e.type.startsWith('flag-')||e.type==='capture')&&actorModel)e={...e,pos:actorModel.position.clone().add(V(0,1,0))};
     // Change only the visual origin; authoritative hit endpoints and camera aim stay untouched.
     if(e.from&&(e.type==='shot'||e.type==='launch')){const weapon=e.actor===this.playerId?(this.hands?.visible?this.firstPerson:null):actorModel?.userData.weapon;if(weapon?.userData.type===e.weapon&&weapon.userData.muzzle)e={...e,from:weapon.userData.muzzle.getWorldPosition(V())};}
     if(e.type==='shot'||e.type==='vehicle-shot'||e.type==='launch'||e.type==='dash')this.shotEffect(e,info,reduced);
     if(['explosion','death','power','powerup','spawn','jam','flag-pickup','flag-drop','flag-return','capture'].includes(e.type)){const color=e.type==='explosion'?info.color:e.type==='jam'?'#c99aff':e.type==='powerup'?'#ffcf70':e.type.startsWith('flag')||e.type==='capture'?(teamPresentation(e.team,this.display?.teamPalette)?.color??NEUTRAL):e.type==='death'?(CHARACTERS.find(c=>c.id===e.character)?.color??'#fff2ce'):'#74f4de';const impact=info.feel?.impactVisual,count=e.type==='death'&&!reduced?8:1,size=e.type==='death'?.12:impact==='wide'?.42:impact==='burst'?.34:impact==='ring'?.22:.3;if(e.pos)for(let i=0;i<count;i++)this.effectPool.add({pos:e.pos,color,size,life:e.type==='death'?.5:impact==='ring'?.4:.3,expand:reduced||e.type==='death'?0:impact==='ring'?1.5:3,wireframe:e.type==='power'||e.type==='powerup'||e.type==='spawn',velocity:e.type==='death'&&!reduced?V((Math.random()-.5)*4,Math.random()*3,(Math.random()-.5)*4):null});}
      if(e.type==='explosion'){const w=e.weapon??1;if(w===4){this.effectPool.add({pos:e.pos,color:'#bff4ff',size:.3,life:.35,expand:reduced?0:1.8});this.effectPool.add({pos:e.pos,color:'#72cfff',size:.5,life:.42,expand:reduced?0:2.4});}else if(w===5){if(!reduced)for(let i=0;i<7;i++)this.effectPool.add({pos:e.pos,color:'#ffb27a',size:.06,life:.5,velocity:V((Math.random()-.5)*9,Math.random()*6,(Math.random()-.5)*9),wireframe:true});}else if(w===1&&!reduced){for(let i=0;i<6;i++)this.effectPool.add({pos:e.pos,color:'#ffcf9a',size:.07,life:.45,velocity:V((Math.random()-.5)*8,Math.random()*5,(Math.random()-.5)*8)});}}
     if(e.type==='shot'||e.type==='launch'){const until=performance.now()+(info.feel?.muzzle?.[1]??.06)*1000,model=this.actorModels?.get(e.actor);if(model)model.userData.flashUntil=until;if(e.actor===this.playerId){this.feedback.shot(e.weapon,e.time);this.flashUntil=until;}}if(e.type==='vehicle-shot'){const model=this.vehicleModels?.get(e.vehicle);if(model)model.userData.flashUntil=performance.now()+45;if(e.actor===this.playerId&&e.barrel===0){this.feedback.shot(0,e.time);this.flashUntil=performance.now()+45;}}
      if((e.type==='shot'||e.type==='vehicle-shot')&&!reduced&&this.muzzleLights){const muzzleColor=e.type==='vehicle-shot'?'#ffd166':info.color,muzzleLife=info.feel?.muzzle?.[1]??.06;this.muzzleLights.flash(muzzleColor,e.from??e.pos,muzzleLife);}
      if(e.type==='damage'){const victim=this.actorModels?.get(e.actor);if(victim)victim.userData.hitUntil=performance.now()+220;}
      if(e.type==='damage'&&e.actor===this.playerId&&Number(e.amount)>=10&&!reduced){this.cameraShake??=new CameraShake();this.cameraShake.add(Math.min(1,Number(e.amount)/70));}
      if(e.type==='death'&&!reduced){this.cameraShake??=new CameraShake();if(e.actor===this.playerId)this.cameraShake.add(1);else{const local=this.actorModels?.get(this.playerId),p=e.pos;if(local&&p){const distance=Math.hypot(local.position.x-(p.x||0),local.position.z-(p.z||0));if(distance<8)this.cameraShake.add(.55*(1-distance/8));}}}
 }
   shotEffect(e,info,reduced){this.effectPool??=new EffectPool(this.scene);const from=e.from,to=e.to??e.pos,weapon=e.weapon??0,feel=info.feel||{},color=e.type==='vehicle-shot'?'#ffd166':(info.color||'#c2ffea'),tracer=feel.tracer||[.085,.055];
    if(e.type==='dash'){if(from&&to)this.effectPool.add({from,to,color:'#c99aff',life:.12,size:.08});return;}
    if(e.type==='launch'){if(to){this.effectPool.add({pos:to,color,size:(feel.muzzle?.[0]||.12)*1.5,life:feel.muzzle?.[1]||.09});this.effectPool.add({pos:to,color:'#ffffff',size:.06,life:.08});}return;}
    if(e.type==='vehicle-shot'){if(from&&to){this.effectPool.add({from,to,color,life:.08,size:.06});this.effectPool.add({pos:to,color:'#fff2ce',size:.09,life:.12,expand:reduced?0:.3});}return;}
    if(!from||!to)return;
    if(weapon===2&&this.railPool){this.railPool.spawn(from,to,color,reduced);this.railImpact(to,color,reduced);return;}
    if(weapon===6){this.lightning(from,to,color,reduced);this.impact(weapon,to,color,reduced,e.hit);return;}
    if(weapon===3||weapon===7){this.effectPool.add({from,to,color,life:.06,size:weapon===7?.055:.04});this.impact(weapon,to,color,reduced,e.hit);return;}
    if(weapon===8){this.effectPool.add({from,to,color,life:.14,size:.05});this.effectPool.add({from,to,color:'#ffffff',life:.06,size:.022});this.impact(weapon,to,color,reduced,e.hit);return;}
    if(weapon===9){this.effectPool.add({from,to,color,life:.05,size:.035});this.impact(weapon,to,color,reduced,e.hit);return;}
    this.effectPool.add({from,to,color,life:tracer[0],size:tracer[1]});this.impact(weapon,to,color,reduced,e.hit);
   }
   lightning(from,to,color,reduced){const segments=reduced?5:9,dx=(to.x-from.x)/segments,dy=(to.y-from.y)/segments,dz=(to.z-from.z)/segments,amp=reduced?.05:.16;let px=from.x,py=from.y,pz=from.z;for(let i=0;i<segments;i++){const last=i===segments-1,jitter=last?0:amp,ox=(Math.random()-.5)*jitter,oy=(Math.random()-.5)*jitter,oz=(Math.random()-.5)*jitter,nx=px+dx+ox,ny=py+dy+oy,nz=pz+dz+oz;this.effectPool.add({from:{x:px,y:py,z:pz},to:{x:nx,y:ny,z:nz},color,life:.07,size:.03});this.effectPool.add({from:{x:px,y:py,z:pz},to:{x:nx,y:ny,z:nz},color:'#ffffff',life:.04,size:.012});px=nx;py=ny;pz=nz;}}
   railImpact(pos,color,reduced){this.effectPool.add({pos,color:'#e8f7ff',size:.2,life:.22,expand:reduced?0:.7,wireframe:!reduced});this.effectPool.add({pos,color,size:.12,life:.3,expand:reduced?0:.4});if(!reduced)for(let i=0;i<6;i++)this.effectPool.add({pos,color:'#ffffff',size:.05,life:.24,velocity:V((Math.random()-.5)*7,(Math.random()-.2)*7,(Math.random()-.5)*7)});}
   impact(weapon,pos,color,reduced,hit){if(!pos)return;const base=hit?'#fff2ce':color;if(weapon===3||weapon===7){this.effectPool.add({pos,color:base,size:weapon===7?.13:.1,life:.14,expand:reduced?0:.5});if(!reduced)for(let i=0;i<4;i++)this.effectPool.add({pos,color:'#6b7681',size:.045,life:.3,velocity:V((Math.random()-.5)*6,Math.random()*3,(Math.random()-.5)*6)});return;}if(weapon===6){this.effectPool.add({pos,color:'#dff6ff',size:.11,life:.14,expand:reduced?0:.6});if(!reduced)for(let i=0;i<5;i++)this.effectPool.add({pos,color,size:.04,life:.2,velocity:V((Math.random()-.5)*8,(Math.random()-.5)*8,(Math.random()-.5)*8),wireframe:true});return;}if(weapon===4){this.effectPool.add({pos,color,size:.14,life:.2,expand:reduced?0:1.1});this.effectPool.add({pos,color:'#ffffff',size:.07,life:.14});return;}this.effectPool.add({pos,color:base,size:hit?.09:.055,life:hit?.16:.1,expand:reduced?0:.25});}
  deathFx(){return this.deathPool??=new DeathPool(this.scene,this.renderer?.isSoftware===true?40:72);}
  spawnDeath(e,reduced){
   if(!e?.pos)return;
   const plan=deathPlan({weapon:e.weapon,overkill:e.overkill,fall:e.fall===true,seed:e.seed??0});
   this.deathContext.set(e.actor,{plan,pos:e.pos,direction:e.direction??null,start:null});
   const pool=this.deathFx();
   pool.spawn(e.pos,{pieces:plan.pieces,force:plan.force,color:plan.color,reduced,seed:e.seed??0});
   if(plan.gore>0){this.effectPool??=new EffectPool(this.scene);const count=reduced?Math.min(3,plan.gore):plan.gore;for(let i=0;i<count;i++)this.effectPool.add({pos:e.pos,color:plan.color,size:.045+Math.random()*.05,life:.55,velocity:V((Math.random()-.5)*7,Math.random()*5,(Math.random()-.5)*7)});}
   if(e.fall!==true&&!plan.hideBody&&Number.isFinite(e.pos.y))pool.splat({x:e.pos.x,y:e.pos.y-1,z:e.pos.z},{color:plan.energy?'#20343d':'#570c0c',reduced,seed:e.seed??0});
  }
  poseCorpse(m,a,match){
   const reduced=this.reduced();
   let ctx=this.deathContext.get(a.id);
   if(!ctx){const plan=deathPlan({seed:(a.id*7+(a.deaths??0)*13)>>>0});ctx={plan,pos:{x:a.x,y:a.y,z:a.z},direction:null,start:null};this.deathContext.set(a.id,ctx);}
   if(ctx.start===null)ctx.start=Number.isFinite(match?.time)?match.time:0;
   const plan=ctx.plan,t=Math.max(0,(Number.isFinite(match?.time)?match.time:ctx.start)-ctx.start),x=Number.isFinite(a.x)?a.x:ctx.pos.x,y=Number.isFinite(a.y)?a.y:ctx.pos.y,z=Number.isFinite(a.z)?a.z:ctx.pos.z;
   m.userData.corpse=true;
   if(m.userData.head)m.userData.head.visible=plan.hideHead!==true;
   if(plan.hideBody||a.id===this.playerId){m.visible=false;return;}
   m.visible=true;
   const yaw=ctx.direction?Math.atan2(-ctx.direction.x,-ctx.direction.z):(Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0));
   const fall=reduced?1:Math.min(1,t/.55),ease=fall*fall*(3-2*fall),tilt=ease*(Math.PI/2)*.9;
   const mode=plan.style==='splatter'?2:plan.style==='electrocute'?1:Math.floor(hashUnit(a.id,plan.pieces,a.deaths??0)*3);
   m.rotation.order='YXZ';
   if(mode===2)m.rotation.set(0,yaw,tilt);else m.rotation.set(mode===0?-tilt:tilt,yaw,0);
   m.position.set(x,y+.04-ease*.12,z);
   m.userData.rig?.update({dt:0,time:match?.time??0,speed:0,maxSpeed:8,grounded:true,crouch:false,ads:false,strafe:0,forward:0,hit:0});
  }
  reviveCorpse(m){
   if(m.userData.corpse!==true)return;
   m.userData.corpse=false;m.visible=true;m.rotation.order='XYZ';m.rotation.x=0;m.rotation.z=0;
   if(m.userData.head)m.userData.head.visible=true;
  }
   // Camera collision for the cinematic/demo director: cast from the followed
   // actor back toward the camera, then ease the stand-off distance in front of
   // whatever blocks the view. Evaluated every frame and smoothed so the camera
   // never alternates between two poses or pops across an obstruction.
   _clearCamera(player,delta,snap){
    if(this.renderer?.isSoftware===true||!this.worldGroup||!player||this.director?.tour)return;
    const aim=this.director?.aim,cam=this.camera.position;
    const head=aim&&Number.isFinite(aim.x)?new T.Vector3(aim.x,aim.y,aim.z):new T.Vector3(player.x||0,(player.y||0)+1.35,player.z||0);
    const dx=head.x-cam.x,dy=head.y-cam.y,dz=head.z-cam.z,dist=Math.hypot(dx,dy,dz);
    if(!(dist>2.2)){this._camWant=undefined;return;}
    const out=new T.Vector3(-dx/dist,-dy/dist,-dz/dist);
    this.raycaster.near=.05;this.raycaster.far=dist;this.raycaster.set(head,out);
    const hits=this.raycaster.intersectObject(this.worldGroup,true);
    let block=null;
    for(const h of hits){if(h.distance<=.05||h.object?.userData?.noCameraOcclusion)continue;block=h;break;}
    const want=occlusionDistance(head,cam,block?block.distance:Infinity);
    if(!Number.isFinite(want))return;
    const dt=Math.min(Math.max(Number(delta)||0,0),.1);
    if(snap||!Number.isFinite(this._camWant)){this._camWant=want;this._camHold=0;}
    else if(want<this._camWant-.05){this._camWant+=(want-this._camWant)*(1-Math.exp(-14*dt));this._camHold=.7;}
    else{this._camHold=Math.max(0,(this._camHold||0)-dt);if(this._camHold<=0)this._camWant+=(want-this._camWant)*(1-Math.exp(-1.5*dt));}
    if(Math.abs(this._camWant-dist)<.05)return;
    cam.set(head.x+out.x*this._camWant,head.y+out.y*this._camWant,head.z+out.z*this._camWant);
    this.camera.rotation.set(Math.max(-1.45,Math.min(1.45,Math.asin(Math.max(-1,Math.min(1,dy/dist))))),Math.atan2(-dx,-dz),0,'YXZ');
   }
   // Cinematic race demo: alternate rigs and featured cars on a fixed cadence.
   // Reduced motion collapses to the original gentle single follow so the shot
   // stays stable; the first frame and every rig/car change snap, then damp.
   _raceDemoCamera(match,arena,player,delta,time,reduced){
    const vehicles=(match.vehicles||[]).filter(Boolean);
    const vehicle=vehicles.find(v=>v.id===player.vehicleId)||vehicles[0]||null;
    if(!vehicle)return false;
    const centerline=arena?.race?.centerline||match.race?.centerline||match.arena?.race?.centerline||[];
    if(reduced){
     const pose=raceDemoPose({mode:'chase',centerline,vehicle,vehicles,elapsed:0});
     this.camera.position.set(pose.x,pose.y,pose.z);
     this.camera.lookAt(pose.lookX,pose.lookY,pose.lookZ);
     this._raceCam=null;
     return true;
    }
    const elapsed=Number.isFinite(match.time)?Math.max(0,match.time):(Number.isFinite(time)?Math.max(0,time):0);
    const mode=raceDemoMode(elapsed),target=raceDemoPose({mode,centerline,vehicle,vehicles,elapsed});
    const segment=Math.floor(elapsed/RACE_DEMO_MODE_SECONDS),previous=this._raceCam;
    if(!previous||previous.mode!==mode||previous.segment!==segment){
     this.camera.position.set(target.x,target.y,target.z);
     this.camera.lookAt(target.lookX,target.lookY,target.lookZ);
     this._raceCam={mode,segment,x:target.x,y:target.y,z:target.z,lookX:target.lookX,lookY:target.lookY,lookZ:target.lookZ};
     return true;
    }
    const dt=Math.min(Math.max(Number(delta)||0,0),.1),k=1-Math.exp(-6*dt);
    const x=previous.x+(target.x-previous.x)*k,y=previous.y+(target.y-previous.y)*k,z=previous.z+(target.z-previous.z)*k;
    const lookX=previous.lookX+(target.lookX-previous.lookX)*k,lookY=previous.lookY+(target.lookY-previous.lookY)*k,lookZ=previous.lookZ+(target.lookZ-previous.lookZ)*k;
    this.camera.position.set(x,y,z);
    this.camera.lookAt(lookX,lookY,lookZ);
    this._raceCam={mode,segment,x,y,z,lookX,lookY,lookZ};
    return true;
   }
   render(mode,match,delta,time){this.motionQuery??=window.matchMedia?.('(prefers-reduced-motion: reduce)');this.resize();const reduced=this.reduced();if(mode==='selection'&&!this.showcaseState){const m=this.menu.model;m.rotation.y=Math.PI+.25+(reduced?0:Math.sin(time*.25)*.2);m.position.y=.17+(reduced?0:Math.sin(time)*.025);m.userData.rig?.update({dt:Math.max(0,Math.min(.1,delta||0)),time,speed:0,maxSpeed:8,grounded:true});this.renderer.render(this.menu.scene,this.menu.camera);return;}if((mode==='selection'||mode==='theater')&&!match)match=this.showcaseState;
      if(!match)return;const cinematic=this.cinema===true&&!!this.director;const actors=match.actors||[];let player=cinematic?actors[0]:(actors.find(a=>a.id===this.playerId)||actors[0]);if(this.spectator&&!cinematic)player=spectateActor(actors,this.spectatorTarget)||player;if(!player)return;const arena=match.arena||MAPS.find(a=>a.id===match.mapId)||MAPS[0];const savedPlayerId=this.playerId;this.updateFlags(match,arena);this.updateObjectives(match,arena);this.updateWaypoint(match,arena);this.updatePayloadModel(match,arena,time);if(cinematic)this.playerId=-1;const cinemaPose=cinematic?this.director.update(match,Math.max(0,delta),match.events||[]):null;if(this.freeCam){this.camera.position.set(this.freePose.x,this.freePose.y,this.freePose.z);this.camera.rotation.set(this.freePose.pitch,this.freePose.yaw,0,'YXZ');}else if(cinematic){this.camera.position.set(cinemaPose.x,cinemaPose.y,cinemaPose.z);this.camera.rotation.set(cinemaPose.pitch,cinemaPose.yaw,cinemaPose.roll||0,'YXZ');this._clearCamera(player,delta,cinemaPose.cut);}else{const eyeY=(player.y||0)+(player.health>0?(player.eyeHeight??1.45):.65),yaw=(player.yaw||0)+(player.punchYaw||0),pitch=(player.pitch||0)+(player.punchPitch||0);if(this.spectator&&this.spectatorThird===true){const dist=4.6,cos=Math.cos(pitch);this.camera.position.set((player.x||0)+Math.sin(yaw)*dist*cos,eyeY+1.1-Math.sin(pitch)*dist,(player.z||0)+Math.cos(yaw)*dist*cos);}else this.camera.position.set(player.x||0,eyeY,player.z||0);this.camera.rotation.set(pitch,yaw,0,'YXZ');}this.cameraShake??=new CameraShake();const aiming=this.aim===true||player.ads===true,baseFov=this.display?.fov??82,targetFov=aiming?Math.max(55,baseFov*.82):player.sprinting===true?baseFov+5:baseFov,fovBlend=1-Math.exp(-8*Math.min(Math.max(delta||0,0),.1));this.camera.fov=Math.max(55,this.camera.fov+(targetFov-this.camera.fov)*fovBlend);if(cinematic)this.camera.fov=Math.max(50,Math.min(100,cinemaPose.fov||this.camera.fov));if(this.freeCam)this.camera.fov=Math.max(50,Math.min(100,this.display?.fov??82));this.camera.updateProjectionMatrix();if(this.freeCam){this.lowHealthOverlay?.update(false,time,delta,reduced,this.camera);}else if(!cinematic){this.cameraShake.apply(this.camera,time,reduced);this.cameraShake.update(Math.max(0,delta));this.lowHealth=player.health>0&&player.health<=(player.maxHealth??100)*.35;this.lowHealthOverlay?.update(this.lowHealth,time,delta,reduced,this.camera);}else this.lowHealthOverlay?.update(false,time,delta,reduced,this.camera);
      actors.forEach((a,i)=>{const m=this.actorModels.get(a.id);if(!m)return;const mounted=a.vehicleId!=null;if(a.health<=0){this.poseCorpse(m,a,match);return;}this.deathContext.delete(a.id);this.reviveCorpse(m);m.visible=a.id!==this.playerId;m.position.set(a.x||0,(a.y||0)+.04,a.z||0);if(mounted){const rider=match.vehicles?.find(v=>v.id===a.vehicleId);m.rotation.y=(rider?.yaw??a.yaw??0)-Math.PI;}else m.rotation.y=Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0);const bodyYaw=Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0),speed=Math.hypot(a.vx||0,a.vz||0),localX=(a.vx||0)*Math.cos(bodyYaw)-(a.vz||0)*Math.sin(bodyYaw),localZ=-((a.vx||0)*Math.sin(bodyYaw)+(a.vz||0)*Math.cos(bodyYaw));m.userData.rig?.update({dt:Math.max(0,Math.min(.1,delta||0)),time,speed:mounted?0:speed,maxSpeed:a.moveSpeed||8,grounded:mounted?true:a.grounded!==false,crouch:!mounted&&a.crouching===true,ads:!mounted&&a.ads===true,strafe:mounted?0:Math.max(-1,Math.min(1,localX/3)),forward:mounted?0:Math.max(-1,Math.min(1,localZ/3)),focusYaw:Math.atan2(Math.sin((a.yaw||0)-bodyYaw),Math.cos((a.yaw||0)-bodyYaw)),focusPitch:-(a.pitch||0),bank:reduced?0:Math.max(-1,Math.min(1,((a.yaw||0)-bodyYaw)*1.1)),hit:!reduced&&(m.userData.hitUntil??0)>performance.now()?1:0});if(m.userData.gunAnchor)m.userData.gunAnchor.rotation.x=reduced?0:Math.max(-.7,Math.min(.7,-(a.pitch||0)));if(!reduced&&a.health>0&&a.active>0&&a.harness==='hermes'&&(match.time||0)-(m.userData.trailAt||0)>.1){m.userData.trailAt=match.time;this.effectPool??=new EffectPool(this.scene);this.effectPool.add({pos:V(a.x,a.y+.4,a.z),color:m.userData.color,size:.11,life:.3});}m.userData.torso.material.emissive.set(a.active>0&&['opencode','codex','cline','roo'].includes(a.harness)?m.userData.color:'#000000');m.userData.torso.material.emissiveIntensity=a.active>0?.7:0;m.userData.shield.material.color.set(a.slow>0?'#d89aff':m.userData.color);m.userData.shield.visible=a.slow>0||a.protection>0||(a.harness==='claudecode'&&a.active>0);if(m.userData.weapon.userData.type!==a.weapon){m.userData.gunAnchor.remove(m.userData.weapon);this.disposeObject(m.userData.weapon);m.userData.weapon=weaponModel(a.weapon,this.modelAssets,a.attachments?.visual,a.finish);this._trackAssets();m.userData.weapon.scale.setScalar(.7);m.userData.gunAnchor.add(m.userData.weapon);}m.userData.weapon.userData.flash.visible=!reduced&&(m.userData.flashUntil??0)>performance.now();});
   this.updateRace(match,time);
   if(match.race&&!this.freeCam&&!this.directorLock){if(cinematic)this._raceDemoCamera(match,arena,player,delta,time,reduced);else{const standingsCar=match.race.kind==='soccer'?match.race.standings?.find(r=>r.actorId===player.id)?.vehicleId:null;const car=match.vehicles?.find(v=>v.id===player.vehicleId)||(match.race.kind==='soccer'?(match.vehicles?.find(v=>v.id===standingsCar)||match.vehicles?.[0]):null);if(car){const centerline=arena?.race?.centerline||match.race?.centerline||match.arena?.race?.centerline||[],pose=raceDemoPose({mode:'chase',centerline,vehicle:car});this.camera.position.set(pose.x,pose.y,pose.z);this.camera.lookAt(pose.lookX,pose.lookY,pose.lookZ);}}}
   for(const actor of actors){const model=this.actorModels.get(actor.id);if(model)this.styleActor(model,actor,this.display?.teamPalette);}
   for(const zone of (match.objectives??match.objectiveState)?.zones||[]){const model=this.objectiveModels?.get(String(zone.id));if(!model)continue;const mark=model.userData.teamMark??=teamMark();if(!mark.parent){mark.position.y=1.45;mark.scale.setScalar(2);model.add(mark);mark.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});}updateTeamMark(mark,zone.contested?null:zone.owner);}
   (match.pickups||[]).forEach((p,i)=>{const m=this.pickupModels[i];if(!m)return;m.visible=(p.wait||0)<=0;m.rotation.y=reduced?0:time*.8;m.position.y=(p.y||0)+(reduced?0:Math.sin(time*2+i)*.07);});
   this.projectilePool??=new EffectPool(this.scene,64);this.projectilePool.clear();for(const r of (match.rockets||[]).slice(0,64))if(r.pos){const wp=r.weapon??0;if(wp===4){this.projectilePool.add({pos:r.pos,color:'#72cfff',size:.2,life:1});this.projectilePool.add({pos:r.pos,color:'#dff6ff',size:.09,life:1});}else if(wp===5)this.projectilePool.add({pos:r.pos,color:'#ffb27a',size:.13,life:1});else this.projectilePool.add({pos:r.pos,color:'#ffad61',size:.15,life:1});}
  for(const e of (match.events||[]))if(e.id>this.lastEvent){this.effect(e);this.lastEvent=e.id;}
   this.effectPool?.update(Math.max(0,delta));this.railPool?.update(Math.max(0,delta));this.deathPool?.update(Math.max(0,delta));
       this.hands.visible=player.health>0&&this.showWeapon!==false&&!this.spectator&&!cinematic&&!this.freeCam&&player.vehicleId==null;const weaponSig=`${player.finish??''}|${weaponVisualKey(player.attachments?.visual)}`;if(this.currentWeapon!==player.weapon||this._viewWeaponSig!==weaponSig){for(const c of [...this.hands.children]){this.hands.remove(c);this.disposeObject(c);}this.firstPerson=weaponModel(player.weapon,undefined,player.attachments?.visual,player.finish);this.firstPerson.scale.setScalar(1.1);this.hands.add(this.firstPerson);this.currentWeapon=player.weapon;this._viewWeaponSig=weaponSig;this.firstPerson.traverse(m=>{if(m.isMesh){m.renderOrder=100;m.material.depthTest=false;}});}
  this.feedback??=new WeaponFeedback();const pose=this.feedback.update(player,delta,reduced,this.hands.visible);this.hands.position.set(.37+pose.x,-.36+pose.y,-.58+pose.z);this.hands.rotation.set(pose.pitch,0,pose.roll);this.firstPerson.userData.flash.visible=!reduced&&this.hands.visible&&this.flashUntil>performance.now();this.muzzleLights?.update(Math.max(0,delta));if(this.renderer.shadowMap?.autoUpdate===false){const st=shadowTick(this._shadowTick);this._shadowTick=st.tick;if(st.refresh)this.renderer.shadowMap.needsUpdate=true;}if(this.composer)this.composer.render();else this.renderer.render(this.scene,this.camera);if(cinematic)this.playerId=savedPlayerId;if(mode==='selection'&&this.showcaseState)this._renderPreview(time,reduced);}
      updateRace(match,time){syncRacePresentation(this,match,time);}
    _renderPreview(time,reduced){const rect=this.previewRect;if(!rect||rect.width<12||rect.height<12||!(this.renderer instanceof T.WebGLRenderer))return;const renderer=this.renderer,w=this.width,h=this.height;if(w<=0||h<=0)return;const x=Math.max(0,Math.round(rect.left)),y=Math.max(0,Math.round(h-rect.bottom)),vw=Math.max(1,Math.round(rect.width)),vh=Math.max(1,Math.round(rect.height));const m=this.menu.model;m.rotation.y=Math.PI+.25+(reduced?0:Math.sin(time*.4)*.22);m.position.y=.17;const cam=this.menu.camera;cam.aspect=Math.max(.2,vw/vh);cam.updateProjectionMatrix();const prevAuto=renderer.autoClear;renderer.setScissorTest(true);renderer.setViewport(x,y,vw,vh);renderer.setScissor(x,y,vw,vh);renderer.autoClear=true;renderer.render(this.menu.scene,cam);renderer.setScissorTest(false);renderer.setViewport(0,0,w,h);renderer.setScissor(0,0,w,h);renderer.autoClear=prevAuto;}
          dispose(){this.clearObjectiveMarkers();this.effectPool?.dispose();this.projectilePool?.dispose();this.railPool?.dispose();this.deathPool?.dispose();disposeComposer(this.composer);this.composer=null;this.muzzleLights?.dispose();this.lowHealthOverlay?.dispose();this.disposeObject(this.scene);this.disposeObject(this.menu.scene);this.environmentRT?.dispose?.();for(const resource of this.renderResources||[])resource.dispose();this.renderResources?.clear();for(const resource of this.sharedResources||[])resource.dispose();this.sharedResources?.clear();this.modelAssets?.materials.clear();this.modelAssets?.geometries.clear();this.modelAssets?.resources.clear();this.arenaAssets?.materials.clear();this.arenaAssets?.geometries.clear();this.arenaAssets?.resources.clear();clearSurfaceTextures();this._freeCam=false;this._directorLock=false;this.resetFreeCam();this.renderer.dispose();}
}
