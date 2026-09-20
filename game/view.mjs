import * as T from 'three';
import {SoftwareRenderer} from './software.mjs';
import {CHARACTERS,WEAPONS} from './data.mjs';
import {WINGS,OPERATOR_KITS} from './kits.mjs';
import {aim,presentationSupportAt} from './core.mjs';
import {MAPS,pickupWeapon} from './maps.mjs';
import {normalizeDisplay} from './config.mjs';
import {WeaponFeedback,EffectPool,AmbientFX,WeatherFX} from './feedback.mjs';
import {ModelAssets,withAssets,currentAssets,CameraShake,MuzzleLightPool,LowHealthOverlay,RailBeamPool,DeathPool,DecalPool,HitReactionFX,TelegraphPool,WeaponPreviewRig,killcamPose,KILLCAM_DURATION} from './effects-fx.mjs';
import {deathPlan,deathStyleFor,hitReaction,hashUnit} from './deaths.mjs';
import {resolveFinish} from './cosmetics.mjs';
import {buildWeaponBody} from './weapon-models/index.mjs';
import {buildSimpleWeaponBody} from './weapon-models/chassis.mjs';
import {AdsController} from './weapon-ads.mjs';
import {legacyWeaponBody} from './weapon-models/legacy.mjs';
import {CharacterRig} from './character-anim.mjs';
import {CharacterLifecycle,alignLivingCharacter} from './rig.mjs';
import {refineOperatorCharacter} from './models.mjs';
import {terrainTriangles,terrainWallTriangles} from './terrain.mjs';
import {foundryDetails,styleFoundryObjective} from './lattice-foundry-view.mjs';
import {latticePresentationChanges} from './lattice-feedback.mjs';
import {smoothNormals,positionColors} from './terrain-normals.mjs';
import {TEAM_PALETTE,teamPresentation,teamMark,updateTeamMark,applyActorTeam} from './team-presentation.mjs';
import {spectateActor,latticeAnnounceCue} from './hud.mjs';
import {NEUTRAL} from './radar.mjs';
import {cavernShell,facadeDetails,tunnelRenderPaths,propId,applyPropDamage,propBreakPlan,isBreakable} from './structures.mjs';
import {raceDemoMode,raceDemoPose,RACE_DEMO_MODE_SECONDS} from './race-camera.mjs';
import {occlusionDistance} from './camera.mjs';
import {smoothAngle,smoothTowards,smoothFactor,normalizeCameraOwner,cameraOwnerAllowsRace,integrateFreeMove,FREE_CAM_DEFAULT_SPEED,FREE_CAM_BOOST,FREE_CAM_MIN_SPEED,FREE_CAM_MAX_BASE_SPEED} from './camera-modes.mjs';
import {postStage,applyComposerSize,disposeComposer,reducedMotion,normalizeQuality,qualitySettings,qualityIndex,nextQualityTier,QUALITY_LEVELS,frameTriangleBudget,normalizeQualityOverride,bloomResolution,nextQualityState,createFrameWindow,pushFrameTime,framePercentiles} from './post.mjs';
import {budgetedRatio,nextDynamicScale} from './resolution.mjs';
import {GpuTimer} from './perf.mjs';
import {interpolatePose} from './interpolation.mjs';
import {solveSightPose,attachOptic,sightAlignmentError} from './sights.mjs';
import {resolveActiveSight} from './reticle.mjs';
import {surfaceTextures,clearSurfaceTextures,wetSheenTexture,mothMacroTexture,mothSkyTexture,mothEffectTextures,mothMaterialLutTexture} from './textures.mjs';
import {enhanceMothMaterial} from './moth-surface.mjs';
import {createMothLutMaterial} from './moth-material.mjs';
import {MothSpritePlayer} from './moth-sprite.mjs';
import {addSky,addMountains,addScatter,updateScatterSway,ambientProfile,smokeAnchors,skyPhase,HALO_MAPS,skyPalette,biomeAmbience,selectWeather,timeOfDayAt,weatherPreset,WEATHER_KINDS,lightningSchedule,windGustAt,wetSheen} from './environment.mjs';
import {raceTrackModel,updateRace as syncRacePresentation} from './race-presentation.mjs';
export {raceTrackModel};
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {normalizeGraphicsLab} from './graphics-lab.mjs';
import {GraphicsLabPass} from './graphics-lab-pass.mjs';
import {VignetteShader} from 'three/addons/shaders/VignetteShader.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
export {SynthAudio} from './feedback.mjs';
export {WeaponPreviewRig} from './effects-fx.mjs';
// Menu/showcase weapon preview. A host screen can mount a rotating, inspectable
// weapon without touching app/**: build the rig, hand it a canvas mount rect,
// and call update(time). It reuses weaponModel + ModelAssets exactly like the
// in-match viewmodel, so preview and gameplay share geometry/materials.
export function createWeaponPreview(options={}){
 return new WeaponPreviewRig({weaponModel,assets:options.assets,background:options.background});
}
// Shadows are re-rendered on a fixed cadence instead of every frame; the arena
// bake still refreshes immediately on build, and moving actors lag at most one step.
export const SHADOW_REFRESH_INTERVAL=2;
export function shadowTick(previous,interval=SHADOW_REFRESH_INTERVAL){const step=Math.max(1,interval),next=(Number.isFinite(previous)?previous:0)+1;return next>=step?{tick:0,refresh:true}:{tick:next,refresh:false};}
// Elapsed-time shadow scheduling. A per-frame cadence ("every two frames") gets
// more expensive as the refresh rate rises; a fixed Hz budget keeps the cost
// roughly constant across 60/144 Hz.
export function shadowDue(now,last,hz){const period=1/Math.max(1,Number(hz)||30);return !Number.isFinite(last)||now-last>=period;}
// Planar distance from a presentation node to the active camera, for model LOD.
export function distanceOf(node,camera){if(!node||!camera)return 0;const dx=(node.position?.x||0)-camera.position.x,dz=(node.position?.z||0)-camera.position.z;return Math.hypot(dx,dz);}
// Time-accumulator for trail/particle emission. Emitting once per rendered frame
// doubles the particle count at 144 Hz; accumulating elapsed time and emitting at
// a fixed interval keeps the count roughly constant across refresh rates.
export function trailEmissions(accumulated, delta, interval=1/30){
 const step=Math.max(0,Number(delta)||0),period=Math.max(1e-4,Number(interval)||1/30);
 const next=(Number(accumulated)||0)+step,count=Math.floor(next/period);
 return {count,remainder:next-count*period};
}
export const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const buildMaterial=(color,metal=.5,rough=.42,emissive=false)=>new T.MeshStandardMaterial({color,metalness:metal,roughness:rough,...(emissive?{emissive:color,emissiveIntensity:1}:{})});
// Arena/palette materials stay uncached; shared model assets opt into the cache via withAssets.
export const material=(color,metal=.5,rough=.42,emissive=false)=>{const assets=currentAssets();return assets?assets.material(`${color}|${metal}|${rough}|${emissive?1:0}`,()=>buildMaterial(color,metal,rough,emissive)):buildMaterial(color,metal,rough,emissive);};
function geometry(scope,key,make){const assets=scope===undefined?currentAssets():scope;return assets?assets.geometry(key,make):make();}
// Wing lookup for presentation: the same OPERATOR_KITS table the resolver reads
// keeps the silhouette language and telegraph palette from drifting from the
// class data (§3.1).
const WING_BY_CHARACTER=Object.fromEntries(OPERATOR_KITS.map(kit=>[kit.id,WINGS.find(wing=>wing.id===kit.wing)]));
// Movement/spec events that carry a telegraph cue in ArenaView.effect().
const TELEGRAPH_EVENTS=new Set(['windup-start','windup-interrupt','charge-start','move-start','landing-recovery','fuel-empty','slam-launch','slam-impact','grapple-hook','grapple-release','rope-place','rope-expire','threat-ping']);
// LATTICE STRIKE node identity. Each archetype gets a distinct zero-cost tint
// for neutral nodes (owned nodes use the team colour) and a distinct emblem
// primitive, so a node reads by archetype and owner without relying on colour.
const COCS_NODE_LABELS={front:'FRONT',economy:'ECON',relay:'RELAY',array:'ARRAY',hq:'HQ'};
const COCS_NODE_TINTS={front:'#c8d6cf',economy:'#7fe3c8',relay:'#bf9cff',array:'#6dbfff',hq:'#9fb4c4'};
export function box(parent,w,h,d,x,y,z,mat,assets){const m=new T.Mesh(geometry(assets,`b|${w}|${h}|${d}`,()=>new T.BoxGeometry(w,h,d)),mat);m.position.set(x,y,z);parent.add(m);return m;}
function cylinder(parent,r1,r2,h,x,y,z,mat,segments=12,assets){const m=new T.Mesh(geometry(assets,`c|${r1}|${r2}|${h}|${segments}`,()=>new T.CylinderGeometry(r1,r2,h,segments)),mat);m.position.set(x,y,z);parent.add(m);return m;}
export function ring(parent,r,t,x,y,z,mat,rx=Math.PI/2,assets){const m=new T.Mesh(geometry(assets,`t|${r}|${t}`,()=>new T.TorusGeometry(r,t,6,32)),mat);m.position.set(x,y,z);m.rotation.x=rx;parent.add(m);return m;}
function tube(parent,ax,ay,az,bx,by,bz,r,mat,segments=6,assets){const start=V(ax,ay,az),dir=V(bx-ax,by-ay,bz-az),length=dir.length()||.0001,m=new T.Mesh(geometry(assets,`u|${r}|${length}|${segments}`,()=>new T.CylinderGeometry(r,r,length,segments)),mat);m.position.copy(start).addScaledVector(dir,.5);m.quaternion.setFromUnitVectors(V(0,1,0),dir.normalize());parent.add(m);return m;}
const shadeHash=(x,y,z,seed)=>{let h=Math.imul((x|0)+374761393,668265263)^Math.imul((y|0)+1274126177,2246822519)^Math.imul((z|0)+2654435761,3266489917)^Math.imul(seed|0,668265263);h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967295;};
// Deterministic per-vertex luminance jitter plus a per-triangle tint. Seeded, never Math.random.
export function paintGeometry(geometry,seed=1,jitter=.16,tint=[1,1,1]){
 if(!geometry?.attributes?.position)return geometry;
 const position=geometry.attributes.position,count=position.count,indexed=!!geometry.index,colors=new Float32Array(count*3);
 if(indexed)for(let i=0;i<count;i++){const m=(1-jitter*.5)+jitter*shadeHash(Math.round(position.getX(i)*5),Math.round(position.getY(i)*5),Math.round(position.getZ(i)*5),seed);colors[i*3]=tint[0]*m;colors[i*3+1]=tint[1]*m;colors[i*3+2]=tint[2]*m;}
 else for(let i=0;i<count;i+=3){const cx=(position.getX(i)+position.getX(i+1)+position.getX(i+2))/3,cy=(position.getY(i)+position.getY(i+1)+position.getY(i+2))/3,cz=(position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))/3,tri=(1-jitter*.5)+jitter*shadeHash(Math.round(cx*5),Math.round(cy*5),Math.round(cz*5),seed);for(let k=0;k<3;k++){const j=i+k,m=tri*((1-jitter*.5*.3)+jitter*.3*shadeHash(Math.round(position.getX(j)*13),Math.round(position.getY(j)*13),Math.round(position.getZ(j)*13),seed+31));colors[j*3]=tint[0]*m;colors[j*3+1]=tint[1]*m;colors[j*3+2]=tint[2]*m;}}
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 return geometry;
}
// Flat contact disc drawn only for the CPU renderer, which has no shadow maps.
// It is parented to the model so the existing disposal traversal owns it.
function addBlobShadow(parent,radius,opacity=.34){
 const shadow=new T.Mesh(new T.CircleGeometry(radius,20),new T.MeshBasicMaterial({color:'#05080b',transparent:true,opacity,depthWrite:false,side:T.DoubleSide}));
 shadow.rotation.x=-Math.PI/2;shadow.position.y=.06;shadow.renderOrder=1;
 shadow.userData.blobShadow=true;shadow.userData.noCameraOcclusion=true;
 parent.add(shadow);return shadow;
}
const arenaSeedOf=arena=>String(arena?.id||'arena').split('').reduce((hash,char)=>(Math.imul(hash,31)+char.charCodeAt(0))>>>0,7);
// Baked Moth atmosphere per map, applied to the standard sky dome. Maps that are
// not listed keep the procedural addSky gradient. `nebula` is deliberately
// unused: the bake decodes to a fully black equirect (mean/max 0), so wiring it
// would render a black dome instead of an atmosphere.
const MOTH_ATMOSPHERE_MAPS=Object.freeze({
 'ember-caldera':'ashen','slagworks':'ashen','forge':'ashen','ashen-rift':'ashen',
 frostline:'frost','frost-gate':'frost',
 'neon-vertical':'void',aether:'void',substation:'void','derelict-station':'void','ironfall-megastructure':'void',
 'moth-backrooms':'void',
});
export function mothAtmosphereFor(arenaId){return MOTH_ATMOSPHERE_MAPS[String(arenaId)]||null;}
// Baked Moth reverb space per map. Interiors, tunnels and caverns override the
// open-air default so the soundtrack's convolution tail matches the room the
// player is actually in. Names match the `irs` keys in the baked module.
const MOTH_SPACE_MAPS=Object.freeze({
 'moth-backrooms':'cavern',
 catacombs:'tunnel',substation:'tunnel',slagworks:'tunnel',forge:'tunnel',
 atrium:'cathedral',colosseum:'hall','derelict-station':'hall',fortress:'hall',throne:'hall',gauntlet:'hall',
 // The neon/void theatres share the long `void` response, so all six baked
 // spaces (open-air/tunnel/hall/cathedral/cavern/void) are reachable.
 'neon-vertical':'void',aether:'void','ironfall-megastructure':'void',
});
export function mothSpaceFor(arenaId){return MOTH_SPACE_MAPS[String(arenaId)]||'open-air';}
// Baked Moth echo/tap map per map. Every arena reads the single baked `arena`
// map so the shared gunfire/explosion send keeps its depth; the table exists so
// a future per-map take can override the default without touching callers.
const MOTH_ECHO_MAPS=Object.freeze({ arena:'arena' });
export function mothEchoFor(arenaId){return MOTH_ECHO_MAPS[String(arenaId)]||'arena';}
const terrainTextureKind=key=>({grass:'grass',dirt:'sand',rock:'rock',cliff:'rock',concrete:'weathered_concrete',metal:'industrial_mesh',ice:'ice',sand:'sand',snow:'ice',ash:'weathered_concrete',stone:'rough_stucco',lava:'corrugated_metal'}[key]||'rock');
// Collision proxies that next-gen maps render as smooth geometry instead of a box.
const NEXTGEN_PROXY=new Set(['cave','tunnel','rock','tree','crate','column']);
const weaponInfo=type=>WEAPONS[type]||{color:['#ff6f91','#e8ff71','#ff9f43'][Math.abs(type)%3],name:`Weapon ${type}`,short:`W${type}`,feel:{}};
const weaponVisualKey=visual=>{if(!visual)return '';try{return JSON.stringify(visual);}catch{return String(visual);}};
// Per-weapon iron-sight line: [rearX,rearY,rearZ, frontX,frontY,frontZ]. The ADS
// transform is derived from these anchors, and the selected optic attaches along
// the same line, so every weapon shoulders to its own sights.
const WEAPON_SIGHT_LINES=[
 [0,.20,.06,0,.205,-.60],   // 0 Pulse Rifle
 [0,.50,-.56,0,.50,-.72],   // 1 Rocket Launcher (flip-up)
 [0,.27,.02,0,.27,-.645],   // 2 Rail Lance (scope)
 [0,.11,-.18,0,.11,-.78],   // 3 Scattergun (rib)
 [0,.15,-.18,0,.15,-.55],   // 4 Plasma Driver
 [0,.15,-.18,0,.15,-.60],   // 5 Grenade Launcher
 [0,.12,-.20,0,.12,-.62],   // 6 Shock Beam
 [0,.12,-.20,0,.12,-.62],   // 7 Flak Cannon
 [0,.20,-.10,0,.20,-.66],   // 8 Marksman Rifle
 [0,.248,.01,0,.181,-.47],  // 9 SMG (folding irons)
];
const WEAPON_SIGHT_DEFAULT=[0,.16,-.1,0,.16,-.5];
const WEAPON_PART_DEFAULTS={leftGrip:[0,-.14,-.05],rightGrip:[0,-.14,-.05],magazine:[0,-.26,-.16],bolt:[.09,.05,-.16],hinge:[0,0,0]};
// The first-person viewmodel is uniformly scaled and viewed through a dedicated
// weapon camera. The ADS solver needs the same scale and a fixed body distance
// (how far the weapon origin sits in front of the eye), so both live here and are
// mirrored by the weapon-camera pass. Distance — not eye relief — keeps every
// weapon framed consistently and in front of the near plane.
export const VIEWMODEL_SCALE=1.1;
export const VIEWMODEL_GUN_DISTANCE=.82;
const buildSightError=(rear,front,aim)=>sightAlignmentError(rear,front,aim,VIEWMODEL_SCALE);
function assembleWeapon(type,assets,visual,finish,body){return withAssets(assets,()=>{type=Number.isInteger(type)&&type>=0?type:0;const info=weaponInfo(type),finishColors=resolveFinish(finish,null),g=new T.Group(),dark=material(finishColors?.secondary||'#222f37'),light=material(finishColors?.accent||'#73848a'),glow=material(finishColors?.primary||info.color,.3,.3,true);g.userData.type=type;const ctx={T,info,material,box,cylinder,ring,geo:(key,make)=>geometry(assets,key,make),palette:{dark,light,glow}};body(type,g,ctx);
  // Named anchors replace the old unconditional rail + iron sights. Every
  // builder already ships its own sights; the shared tail only records the
  // anchors used to derive ADS, attach the selected optic, and drive reload
  // part animation. Builders may supply movable groups via g.userData.parts.
  // Builders report their real aperture center and front aiming point via
  // g.userData.sights; the legacy WEAPON_SIGHT_LINES table stays only as a
  // fallback for the low-poly legacy bodies.
  const built=g.userData.sights,fallback=WEAPON_SIGHT_LINES[type]||WEAPON_SIGHT_DEFAULT;
  const line=built?[built.rear.x,built.rear.y,built.rear.z,built.front.x,built.front.y,built.front.z]:fallback,parts=g.userData.parts||{};
  const makeAnchor=(name,xyz,detail)=>{const existing=parts[name];if(existing){existing.name=name;return existing;}const node=new T.Group();node.name=name;if(xyz)node.position.set(xyz[0]||0,xyz[1]||0,xyz[2]||0);if(detail)node.userData.weaponDetail=detail;g.add(node);return node;};
  const rearSight=makeAnchor('rearSight',line.slice(0,3),'sight'),frontSight=makeAnchor('frontSight',line.slice(3,6),'sight');
  const partAnchors={rearSight,frontSight,leftGrip:makeAnchor('leftGrip',WEAPON_PART_DEFAULTS.leftGrip),rightGrip:makeAnchor('rightGrip',WEAPON_PART_DEFAULTS.rightGrip),magazine:makeAnchor('magazine',WEAPON_PART_DEFAULTS.magazine),bolt:makeAnchor('bolt',WEAPON_PART_DEFAULTS.bolt),hinge:makeAnchor('hinge',WEAPON_PART_DEFAULTS.hinge)};
  const sightDZ=frontSight.position.z-rearSight.position.z,sightDY=frontSight.position.y-rearSight.position.y;
  g.userData.anchors=partAnchors;g.userData.parts=parts;
  // Derive the ADS pose from the real anchors after model scale is known: the
  // solver aligns the rear aperture to the weapon-camera center ray at a fixed
  // eye relief and rotates the bore onto the camera forward axis (accounting for
  // a rear anchor that is off the origin), rather than negating an unrotated
  // offset. `sightError` records the residual for the geometric tests.
  g.userData.aim=solveSightPose(rearSight.position,frontSight.position,{scale:VIEWMODEL_SCALE,distance:VIEWMODEL_GUN_DISTANCE});
  g.userData.sightError=buildSightError(rearSight.position,frontSight.position,g.userData.aim);
  const points=[[[0,.01,-.85]],[[0,0,-.76]],[[0,.025,-1.04]],[[-.12,.03,-.82],[.12,.03,-.82]],[[0,0,-.77]],[[0,.04,-.93]],[[0,0,-.99]],[[0,0,-.99]],[[0,.02,-.84]],[[0,.05,-.835]]][type]||[[0,0,-.83]];
  const muzzle=info.feel?.muzzle||[.12,.06],flash=new T.Group(),anchors=[];
  for(const point of points){const anchor=new T.Group();anchor.position.set(...point);anchor.name='muzzle';g.add(anchor);anchors.push(anchor);const flare=new T.Mesh(new T.SphereGeometry(muzzle[0],6,4),new T.MeshBasicMaterial({color:info.color}));flare.position.copy(anchor.position);flare.scale.z=1.5;flare.name='muzzle-flare';flash.add(flare);}
  // Layered flash petals around each flare: keep the flare itself as the indexed
  // child (weapon-presentation contract) and append detail bursts afterwards.
  for(const point of points){const origin=V(point[0],point[1],point[2]),burst=new T.Group();burst.name='muzzle-flash';burst.userData.muzzleFlash=true;burst.position.copy(origin);const cone=new T.Mesh(new T.ConeGeometry(muzzle[0]*.8,muzzle[0]*2.2,5),new T.MeshBasicMaterial({color:info.color,transparent:true,opacity:.9,depthWrite:false,blending:T.AdditiveBlending}));cone.name='flash-cone';cone.rotation.x=-Math.PI/2;cone.position.z=-muzzle[0]*1.2;burst.add(cone);for(const angle of [0,Math.PI/2]){const petal=new T.Mesh(new T.PlaneGeometry(muzzle[0]*3.2,muzzle[0]*.55),new T.MeshBasicMaterial({color:info.color,transparent:true,opacity:.7,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending}));petal.name='flash-petal';petal.rotation.z=angle;burst.add(petal);}flash.add(burst);}
  flash.visible=false;g.add(flash);g.userData.flash=flash;g.userData.muzzles=anchors;g.userData.muzzle=anchors[0];g.userData.feel=info.feel;g.userData.anchors.muzzle=anchors[0];g.userData.anchors.muzzles=anchors;
  if(visual){const acc=material(visual.color||'#8affc1',.4,.3,true),mod=material('#161d22',.6,.5);
   // Attachments mount on the weapon's own sight line (interpolated between the
   // real rear and front anchors), so the optic aperture sits on the aim axis and
   // the sight picture stays unobstructed.
   const onLine=t=>({x:0,y:rearSight.position.y+(frontSight.position.y-rearSight.position.y)*t,z:rearSight.position.z+(frontSight.position.z-rearSight.position.z)*t});
   const opticCtx={...ctx,palette:{...ctx.palette,dark:mod,glow:acc}};
   if(visual.optic==='scope'){const mount=onLine(.35);attachOptic(g,opticCtx,'scope',g.userData.anchors,mount);}
   else if(visual.optic==='holo'){const mount=onLine(.22);attachOptic(g,opticCtx,'holo',g.userData.anchors,mount);}
   else if(visual.optic==='iron'){const mount=onLine(.1);attachOptic(g,opticCtx,'iron',g.userData.anchors,mount);}
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
// New detailed models are dispatched by the weapon-models registry; the old
// low-poly geometry lives in game/weapon-models/legacy.mjs as `legacyWeaponModel`.
export function weaponModel(type=0,assets,visual=null,finish=null){return assembleWeapon(type,assets,visual,finish,buildWeaponBody);}
export function legacyWeaponModel(type=0,assets,visual=null,finish=null){return assembleWeapon(type,assets,visual,finish,legacyWeaponBody);}
// Low-cost third-person weapon. Distant actors only need a readable silhouette
// and a barrel-tip anchor for remote tracers, so the full first-person detail
// (sights, moving parts, attachments) is reserved for the viewmodel the player
// can actually inspect. A handful of meshes replaces ~40 per actor.
export function simpleWeaponModel(type=0,assets,visual=null,finish=null){
 type=Number.isInteger(type)&&type>=0?type:0;
 const info=weaponInfo(type);
 return withAssets(assets,()=>{
  const g=new T.Group();g.name='weapon-simple';g.userData.type=type;g.userData.weapon=true;g.userData.simple=true;
  const dark=material(finish?.secondary||'#222f37',.5,.52),accent=material(finish?.accent||info.color,.4,.32,true);
  buildSimpleWeaponBody(type,g,{T,box,cylinder,palette:{dark,light:accent}});
  const muzzle=new T.Group();muzzle.name='muzzle';muzzle.position.set(...g.userData.muzzlePoint);g.add(muzzle);
  const flash=new T.Group();flash.visible=false;flash.position.copy(muzzle.position);const flare=new T.Mesh(geometry(assets,'simple-weapon-flash',()=>new T.SphereGeometry(.06,6,4)),new T.MeshBasicMaterial({color:info.color}));flare.userData.noShadow=true;flash.add(flare);g.add(flash);
  g.userData.muzzle=muzzle;g.userData.muzzles=[muzzle];g.userData.flash=flash;
  return g;
 });
}
function hornetModel(software=false){const g=new T.Group();g.name='hornet';const hull=material('#3c4652',.7,.4),dark=material('#20262e',.6,.5),accent=material('#ffb35c',.4,.3,true),glass=material('#20323d',.6,.12);
 box(g,1.1,.7,4.6,0,0,-.1,hull);box(g,.7,.5,1.2,0,.25,1.6,hull);
 const nose=new T.Mesh(new T.ConeGeometry(.5,1.4,10),hull);nose.rotation.x=-Math.PI/2;nose.position.set(0,0,-2.6);g.add(nose);
 const pod=new T.Mesh(new T.SphereGeometry(.18,8,6),dark);pod.position.set(0,-.38,-1.8);g.add(pod);
 const lens=new T.Mesh(new T.SphereGeometry(.08,6,4),accent);lens.position.set(0,-.38,-1.96);g.add(lens);
 const canopy=new T.Mesh(new T.SphereGeometry(.62,12,8),glass);canopy.scale.set(1,.7,1.5);canopy.position.set(0,.5,.2);g.add(canopy);
 for(const s of [-1,1]){const wing=box(g,2.6,.14,1.5,s*1.7,0,.2,hull);wing.rotation.z=s*.05;box(g,.5,.3,.9,s*2.3,0,.5,dark);box(g,.16,.5,.9,s*2.3,-.1,.5,accent);const beacon=new T.Mesh(new T.BoxGeometry(.06,.06,.18),s>0?new T.MeshBasicMaterial({color:'#33ff77'}):new T.MeshBasicMaterial({color:'#ff3333'}));beacon.position.set(s*3.02,.06,.2);g.add(beacon);}
  box(g,1.8,.12,.7,0,.35,2.1,hull);box(g,.12,.7,1,0,.6,2.4,dark);
  for(const s of [-1,1]){const fin=box(g,.06,.45,.65,s*.55,.65,1.9,hull);fin.rotation.x=-.2;fin.rotation.z=s*.12;}
  for(const s of [-1,1])box(g,.24,.14,.6,s*.75,-.28,.35,dark);
  const engines=[],guns=[];
 for(const s of [-1,1]){const nac=cylinder(g,.4,.46,1.8,s*1.7,-.1,.6,dark,12);nac.rotation.x=Math.PI/2;const glow=new T.Mesh(new T.CylinderGeometry(.34,.34,.2,12),accent);glow.rotation.x=Math.PI/2;glow.position.set(s*1.7,-.1,1.55);g.add(glow);engines.push(glow);}
 for(const s of [-1,1]){const mount=new T.Group();mount.position.set(s*1.6,-.05,-1.2);g.add(mount);const barrel=cylinder(mount,.09,.09,1.2,0,0,-.6,dark,8);barrel.rotation.x=Math.PI/2;const flash=new T.Mesh(new T.SphereGeometry(.16,6,4),new T.MeshBasicMaterial({color:'#ffd9a0'}));flash.position.set(0,0,-1.2);flash.visible=false;mount.add(flash);guns.push({mount,barrel,flash});}
 g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
 if(software)addBlobShadow(g,2.3,.32);
 g.userData={kind:'hornet',vehicle:true,wheels:[],turret:null,barrels:engines,guns,flashUntil:0,color:'#5c6b7a'};return g;}
export function vehicleModel(kind='puma',assets,software=false){return withAssets(assets,()=>{
 if(kind==='hornet')return hornetModel(software);
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
  // Spare tire, jerry can, winch drum and tow hook add readable silhouette noise.
  const spareTire=ring(g,.34,.12,0,.88,-1.63,tire,0);spareTire.name='spare-tire';
  const jerryCan=box(g,.32,.44,.2,-.54,.86,-1.36,khaki);jerryCan.name='jerry-can';
  const winch=cylinder(g,.1,.1,.36,0,.6,1.79,steel,10);winch.rotation.z=Math.PI/2;winch.name='winch-drum';
  const towHook=ring(g,.09,.03,0,.42,1.82,steel,0);towHook.name='tow-hook';
  const splitter=box(g,1.72,.032,.36,0,.26,1.72,dark);splitter.name='front-splitter';
  for(const sign of [-1,1]){const vent=box(g,.22,.018,.38,sign*.42,.92,.96,dark);vent.name=`hood-vent-${sign<0?'left':'right'}`;}
  for(const sign of [-1,1]){const pipe=cylinder(g,.04,.04,.42,sign*.95,.24,-.6,steel,8);pipe.rotation.z=Math.PI/2;}
  box(g,1.2,.04,.08,0,1.62,.32,dark);
  for(let i=-2;i<=2;i++){if(i===0)continue;const lamp=cylinder(g,.032,.032,.025,i*.24,1.62,.36,amber,8);lamp.rotation.x=Math.PI/2;}
  g.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    if(software)addBlobShadow(g,2.1,.32);
    g.userData={kind,vehicle:true,wheels,turret,barrels,guns,accessories:{spareTire,jerryCan,winch,towHook,splitter},flashUntil:0,color:'#5f6338'};
   return g;
});}
// Wing silhouette language (§6.6): additive, cached geometry/materials layered
// over the per-operator accents. Each wing gets one body language — Strikers
// lean forward behind swept fins and a leaner torso, Vanguards square up behind
// broader shoulder plates and a boxy chest, Tacticians carry sensor/toolkit
// greebles. Shape pieces stay in the default LOD so the wing reads at range;
// small trim pieces are tagged `lodDetail` and drop out with distance. Geometry
// flows through `geometry(undefined,key,…)` and materials through `material(…)`,
// so rebuilding a model never grows `assets.resources`.
function buildWingSilhouette(parts,wing,{accent,dark}){
 const tag=node=>{if(node)node.userData.lodDetail=true;return node;};
 const {chest,head,hips,backpack,torsoMesh,shoulderPads,arms}=parts;
 if(wing.id==='striker'){
  // Swept fins lean the read forward over the shoulders; the torso is pulled
  // slightly leaner than the base operator body.
  for(const side of [-1,1]){
   const key=side<0?'L':'R',fin=box(backpack,.055,.34,.18,side*.17,.12,.05,accent);
   fin.name=`wing-fin-${key}`;fin.rotation.x=-.6;fin.rotation.z=side*.22;
   const spar=tag(cylinder(backpack,.014,.014,.24,side*.17,.27,.01,dark,6));
   spar.name=`wing-fin-spar-${key}`;spar.rotation.x=-.6;spar.rotation.z=side*.22;
  }
  const collar=tag(box(chest,.34,.05,.26,0,.16,.03,accent));collar.name='wing-collar';collar.rotation.x=.12;
  torsoMesh.scale.set(.97,1.36,.66);
 }
 else if(wing.id==='vanguard'){
  // Broader shoulder plates and a squared chest plate read as a wall.
  for(const pad of shoulderPads)pad.scale.set(1.38,.66,1.28);
  for(const side of [-1,1]){
   const key=side<0?'L':'R',shoulder=arms[key].shoulder,plate=box(shoulder,.3,.075,.3,side*.02,.16,0,accent);
   plate.name=`wing-pauldron-${key}`;plate.rotation.z=side*-.2;
   const rim=tag(box(shoulder,.24,.05,.24,side*.04,.23,0,dark));rim.name=`wing-pauldron-rim-${key}`;rim.rotation.z=side*-.2;
  }
  box(chest,.46,.26,.05,0,-.03,-.2,accent).name='wing-chest-plate';
  const collar=tag(box(chest,.52,.075,.22,0,.15,.02,dark));collar.name='wing-collar';collar.rotation.x=.1;
 }
 else{
  // Tactician sensor mast plus toolkit greebles; the boom stays in the default
  // LOD so the slighter silhouette still reads at distance.
  const mast=cylinder(head,.01,.01,.26,-.14,.2,.01,dark,6);mast.name='wing-sensor-mast';mast.rotation.z=.24;
  const bulb=tag(new T.Mesh(geometry(undefined,'wing-sensor-bulb',()=>new T.SphereGeometry(.052,8,6)),accent));
  bulb.name='wing-sensor-bulb';bulb.position.set(-.17,.32,.01);head.add(bulb);
  const dish=tag(new T.Mesh(geometry(undefined,'wing-dish',()=>new T.ConeGeometry(.07,.05,10)),accent));
  dish.name='wing-sensor-dish';dish.position.set(.12,.17,-.05);dish.rotation.x=Math.PI*.46;head.add(dish);
  tag(box(chest,.17,.14,.07,-.24,-.09,.16,dark)).name='wing-toolkit';
  tag(box(chest,.075,.16,.1,-.3,-.01,.1,accent)).name='wing-tool-module';
  tag(box(hips,.16,.12,.12,.19,-.02,-.05,dark)).name='wing-tool-pouch';
 }
 return wing;
}
export function robotModel(id,assets,software=false){return withAssets(assets,()=>{const c=CHARACTERS.find(ch=>ch.id===id)||CHARACTERS[0],g=new T.Group(),armor=new T.MeshStandardMaterial({color:c.accent,metalness:.72,roughness:.32}),color=material(c.color,.6,.3),dark=material('#18262c',.5,.5),glow=material(c.color,.4,.2,true),wing=WING_BY_CHARACTER[c.id]||WINGS[0],wingAccent=material(wing.color,.42,.3,true);
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
   box(chest,.08,.2,.025,0,-.04,-.21,dark);
  // Backpack greebles: a low core, twin canisters, a vent and a whip antenna.
  const backpack=new T.Group();backpack.name='backpack';backpack.position.set(0,.02,.22);chest.add(backpack);
  ball(backpack,.15,dark,10).scale.set(1.15,.95,.55);
  for(const x of [-.075,.075]){const tank=cylinder(backpack,.045,.045,.26,x,.02,.05,color,8);tank.rotation.x=Math.PI/2;}
  const vent=box(backpack,.2,.06,.06,0,.11,-.06,glow);vent.rotation.x=.2;
  const antenna=cylinder(backpack,.012,.012,.34,.12,.16,.05,dark,6);antenna.rotation.z=-.16;
  const head=new T.Group();head.position.y=.34;chest.add(head);
  ball(head,.19,armor,16).scale.set(.96,1.04,.98);
  const visor=ball(head,.14,dark,12);visor.position.set(0,.01,-.09);visor.scale.set(1.02,.46,.6);
  const eye=ball(head,.075,glow,10);eye.position.set(0,.015,-.19);eye.scale.set(1.05,.42,.5);
  // Visor brow and sensor nub give the head a readable helmet silhouette.
  const brow=ball(head,.155,armor,12);brow.position.set(0,.075,-.075);brow.scale.set(1.04,.16,.62);brow.name='visor-brow';
  const nub=ball(head,.028,glow,8);nub.position.set(0,-.045,-.205);nub.name='visor-nub';
 if(id==='chatgpt')ring(head,.17,.018,0,.02,0,glow,Math.PI/2);
 if(id==='claude'){for(const x of [-.2,.2]){const fin=ball(head,.07,color,8);fin.position.set(x,.05,.02);fin.scale.set(.6,1.7,.9);}const crest=ball(chest,.06,color,8);crest.position.set(0,.16,-.22);crest.scale.set(.5,1.6,.5);}
 if(id==='grok'){const ant=cylinder(head,.012,.012,.34,0,.28,.02,dark,6);const tip=ball(head,.035,glow,8);tip.position.set(.16,.3,.02);}
 if(id==='meta'){for(const x of [-.13,.13])ring(chest,.11,.02,x,.05,-.19,glow,0);}
 if(id==='gemini'){for(const x of [-.11,.11]){const star=ball(head,.055,glow,8);star.position.set(x,.01,-.2);}const spine=ball(chest,.05,color,8);spine.position.set(0,.05,-.24);spine.scale.set(.5,2.4,.5);}
 if(id==='deepseek'){const crest=ball(head,.06,color,8);crest.position.set(0,.2,.02);crest.scale.set(.6,1.8,.8);}
 if(id==='mistral'){for(let i=0;i<3;i++){const fin=ball(head,.05,color,8);fin.position.set(.08-i*.08,.16+i*.03,0);fin.scale.set(1.4,.5,.7);}}
 if(id==='kimi')ring(head,.2,.02,0,.03,0,glow,Math.PI/3);
 if(id==='qwen'){for(let i=0;i<3;i++){const plate=ball(chest,.2-i*.03,color,12);plate.position.set(0,.02+i*.08,-.05);plate.scale.set(1.05,.3,.5);}}
  const arms={},legs={},shoulderPads=[];
  for(const side of [-1,1]){const key=side<0?'L':'R';
   const shoulder=new T.Group();shoulder.position.set(side*.3,.22,0);chest.add(shoulder);ball(shoulder,.13,armor,12).scale.set(1.02,.9,1.02);
   const pad=ball(shoulder,.155,armor,10);pad.position.set(side*.02,.05,0);pad.scale.set(1.2,.62,1.2);pad.name=`shoulder-pad-${key}`;shoulderPads.push(pad);
   const trim=ball(shoulder,.16,dark,10);trim.position.copy(pad.position);trim.scale.set(1.06,.22,1.06);
   const stud=ball(shoulder,.032,glow,6);stud.position.set(side*.05,.13,-.02);
  const upper=new T.Group();shoulder.add(upper);capsule(upper,.082,.2,color).position.y=-.14;
  const elbow=new T.Group();elbow.position.y=-.29;upper.add(elbow);ball(elbow,.082,dark,10);
  const fore=new T.Group();elbow.add(fore);capsule(fore,.068,.19,dark).position.y=-.13;ball(fore,.078,armor,10).position.y=-.26;
  box(fore,.082,.14,.025,0,-.14,-.055,armor);
  arms[key]={shoulder,upper,fore,elbow};
  const hip=new T.Group();hip.position.set(side*.15,0,0);hips.add(hip);ball(hip,.115,dark,10);
  const upperLeg=new T.Group();hip.add(upperLeg);capsule(upperLeg,.1,.25,armor).position.y=-.17;
  const knee=new T.Group();knee.position.y=-.34;upperLeg.add(knee);ball(knee,.09,dark,10);
  const lower=new T.Group();knee.add(lower);capsule(lower,.082,.23,dark).position.y=-.16;
  box(lower,.095,.14,.025,0,-.13,-.065,armor);
  const foot=new T.Group();foot.position.y=-.35;lower.add(foot);const footMesh=ball(foot,.105,armor,10);footMesh.position.set(0,-.02,-.07);footMesh.scale.set(1.05,.7,1.6);
  legs[key]={hip,upper:upperLeg,knee,lower,foot};
 }
 // Wing silhouette layer: added after the operator accents so it can sit on the
 // finished shoulders/backpack, before the shadow policy traverse below.
 buildWingSilhouette({chest,head,hips,backpack,torsoMesh,shoulderPads,arms},wing,{accent:wingAccent,dark});
 const gunAnchor=new T.Group();gunAnchor.position.set(.16,0,-.26);chest.add(gunAnchor);const weapon=simpleWeaponModel(0,assets);gunAnchor.add(weapon);
 const shield=new T.Mesh(new T.SphereGeometry(1.15,16,12),new T.MeshBasicMaterial({color:c.color,transparent:true,opacity:.13,wireframe:true}));shield.scale.set(.7,1,.7);shield.position.y=.9;g.add(shield);shield.visible=false;
 const base=new T.Mesh(new T.RingGeometry(.47,.54,28),new T.MeshBasicMaterial({color:c.color,side:T.DoubleSide,transparent:true,opacity:.7}));base.rotation.x=-Math.PI/2;base.position.y=.02;g.add(base);
 const teamMarks=[];for(const z of [-.29,.19]){const mark=teamMark();mark.position.set(0,.91,z);if(z>0)mark.rotation.y=Math.PI;g.add(mark);teamMarks.push(mark);updateTeamMark(mark,null);}
 // Low-value greebles are presentation-only: tag them so a distant/low-tier
 // operator can hide them without touching the authoritative actor or hitboxes.
 for(const detail of [backpack,vent,antenna,brow,nub,emblem,...shoulderPads])if(detail)detail.userData.lodDetail=true;
 if(software)addBlobShadow(g,.55,.34);
 // Shadow-caster policy: solid body parts cast, but tiny greebles, transparent
 // effects (energy shield, muzzle flash, visor glow) and the team base ring do
 // not. This trims shadow draw calls without changing the visible silhouette.
 g.traverse(n=>{if(!n.isMesh)return;const u=n.userData||{};const skip=(n.material&&n.material.transparent===true)||u.lodDetail===true||u.noShadow===true||String(n.name).includes('flash');n.castShadow=!skip;n.receiveShadow=u.lodDetail!==true;});
 for(const mark of teamMarks)mark.traverse(n=>{if(n.isMesh){n.castShadow=false;n.receiveShadow=false;}});
 const joints={root,rootBaseY:0,hips,torso,chest,head,armUpperL:arms.L.upper,armUpperR:arms.R.upper,forearmL:arms.L.fore,forearmR:arms.R.fore,legUpperL:legs.L.upper,legUpperR:legs.R.upper,legLowerL:legs.L.lower,legLowerR:legs.R.lower,footL:legs.L.foot,footR:legs.R.foot};
 g.userData={limbs:[],head,torso:torsoMesh,chest,torsoGroup:torso,gunAnchor,weapon,shield,color:c.color,armor,armorColor:c.accent,base,teamMarks,shoulderPads,backpack,visor:{brow,nub},wing:wing.id,wingColor:wing.color,rig:new CharacterRig(joints),joints};refineOperatorCharacter(g);return g;});}
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
// Height of the authored cable above the ridden path: the pulley/handle sits a
// little above the rider's shoulders so the line reads as something they hang
// from rather than a rail at their feet.
const ZIP_CABLE_HANDLE=1.15;
// Spark cadence while riding (seconds) and the pooled carriage model's scale.
const ZIP_SPARK_INTERVAL=.07;
function traversalItems(arena,name){const t=arena.traversal||arena.traversalMetadata||{};if(t[name])return t[name];
 // Authored Lattice device arrays store kind-tagged entries; project the
 // zipline rows so cables/carriages draw from the same authored anchors the
 // simulation rides (no second, drifting copy of the geometry).
 if(Array.isArray(t)&&name==='ziplines')return t.filter(d=>d&&d.kind==='zipline').map(d=>({id:d.id,from:d.from,to:d.to,sag:d.sag??0,lift:d.lift??0,speed:d.speed}));
 return arena[name]||[];}
// Surface palettes remain readable in the CPU renderer, which has no shader lighting.
const arenaLooks={
 'puma-circuit':['#292d34','#343c49','#b08042','#ffe1af','#17222d',.006,.35],
 exchange:['#253d40','#182b30','#72918b','#c3ffe9','#163d39',.016,.62],
 // Moth Quantum labyrinth: a cold teal graph-lit interior.
 'moth-backrooms':['#123034','#0d2226','#5fe3d6','#a8fff4','#07181b',.03,.8],
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
   throne:['#3a3226','#241d14','#c9a86a','#ffe0a8','#1a1208',.0105,.35],
   gauntlet:['#3a2a24','#221812','#c07a5a','#ffb089','#150d09',.0135,.6],
   'dune-ravine':['#8a6a3c','#5f4a2c','#d8b878','#ffe6b0','#3a2a16',.006,.2],
   'ember-caldera':['#5a2e22','#3a1d16','#c07a4a','#ffcfa0','#1d0c07',.012,.5],
   // Daylit slate/copper foundry: readable courtyards and long lane silhouettes.
   'lattice-slice':['#718388','#8b9a9a','#d7d3bc','#fff0d3','#87958a',.0038,.18],
   };
// Pooled, presentation-only debris for destructible props. It mirrors the
// DeathPool contract (fixed slots, deterministic transforms, exactly-once
// disposal) but is gated to WebGL and to the quality tier's particle budget.
// The simulation never reads it, so breaking a crate cannot move an actor.
export class DebrisPool{
 constructor(scene,limit=48){
  this.scene=scene;this.limit=Math.max(0,limit|0);this.slots=[];this.serial=0;
  this.chunk=new T.BoxGeometry(.22,.22,.22);
 }
 _slot(){
  let slot=this.slots.find(s=>!s.active);
  if(slot)return slot;
  if(this.slots.length>=this.limit){this.slots.sort((a,b)=>a.serial-b.serial);return this.slots[0]||null;}
  const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false});
  const obj=new T.Mesh(this.chunk,material);obj.visible=false;obj.frustumCulled=false;this.scene.add(obj);
  slot={obj,material,active:false};this.slots.push(slot);return slot;
 }
 // Consume a pure propBreakPlan. Returns the number of chunks spawned.
 spawn(plan){
  if(!plan||!Array.isArray(plan.pieces)||!this.limit)return 0;
  const budget=Math.min(plan.pieces.length,this.limit);
  let spawned=0;
  for(let i=0;i<budget;i++){
   const piece=plan.pieces[i],slot=this._slot();if(!slot)break;
   slot.obj.visible=true;slot.obj.material.color.set(plan.color||'#8a8378');slot.obj.material.opacity=1;
   slot.obj.position.set(piece.offset?.x||0,piece.offset?.y||0,piece.offset?.z||0);
   slot.obj.scale.setScalar(piece.scale||1);
   slot.velocity={...(piece.velocity||{})};slot.spin={...(piece.spin||{})};
   slot.active=true;slot.serial=++this.serial;slot.life=slot.total=Math.max(.2,piece.life||1);
   spawned++;
  }
  return spawned;
 }
 update(dt){
  const step=Math.max(0,Math.min(Number(dt)||0,.1));
  for(const slot of this.slots){
   if(!slot.active)continue;
   slot.life-=step;
   if(slot.life<=0){slot.active=false;slot.obj.visible=false;continue;}
   const v=slot.velocity||{x:0,y:0,z:0};
   v.y-=22*step;
   slot.obj.position.x+=v.x*step;slot.obj.position.y+=v.y*step;slot.obj.position.z+=v.z*step;
   const spin=slot.spin||{x:0,y:0,z:0};
   slot.obj.rotation.x+=spin.x*step;slot.obj.rotation.y+=spin.y*step;slot.obj.rotation.z+=spin.z*step;
   slot.obj.material.opacity=Math.min(1,slot.life/(slot.total*.35));
  }
 }
 clear(){for(const slot of this.slots){slot.active=false;slot.obj.visible=false;}}
 dispose(){for(const slot of this.slots){this.scene.remove(slot.obj);slot.material?.dispose();slot.material=null;}this.slots=[];this.chunk?.dispose();this.chunk=null;}
}
export class ArenaView{
 constructor(canvas){const context=canvas.getContext('webgl2',{antialias:true,alpha:false});this.renderer=context?new T.WebGLRenderer({canvas,context,antialias:true,alpha:false,powerPreference:'high-performance'}):new SoftwareRenderer(canvas);this.gpuTimer=context?new GpuTimer(this.renderer):null;this.display=normalizeDisplay();this._qualityOverride=null;this.quality=null;this.qualitySettings=null;this._fps={frames:0,elapsed:0,value:60};this._drs={scale:1,cool:0};this.dynamicResolution=true;
  // three.js resets renderer.info after every render() call, and the first-person
  // weapon pass is a second render, so the counters read at frame end would only
  // describe the gun. Disable autoReset and reset once per presented frame so the
  // totals after all passes are trustworthy.
  try{if(this.renderer.info)this.renderer.info.autoReset=false;}catch{}
  this._frameWindow=createFrameWindow(120);this._qualityState={level:null,bad:0,good:0,cool:0};
  // Presentation interpolation state. Off by default so authoritative tests and
  // the multiplayer path are untouched; the host opts in for local play.
  this._interpAlpha=1;this._interpEnabled=false;this._present={cur:new Map(),prev:new Map(),vehicles:{cur:new Map(),prev:new Map()},rockets:{cur:[],prev:[]},time:null};this._warmupChain=Promise.resolve();
  this.perf={frames:0,lastFrameMs:0,medianFrameMs:0,p95FrameMs:0,renderMs:0,sceneMs:0,submitMs:0,weaponSubmitMs:0,gpuMs:null,calls:0,triangles:0,lines:0,points:0,geometries:0,textures:0,programs:0,passes:[],viewport:{cssWidth:0,cssHeight:0,devicePixelRatio:1,bufferWidth:0,bufferHeight:0,scale:1},tier:'high',reduced:false,qualityAuto:true};
  this._renderMs=0;this._sceneMs=0;
  this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;this.composer=null;this.bloomPass=null;this.vignettePass=null;this.aaPass=null;this._postKey=null;this._postW=0;this._postH=0;this._postRatio=0;this.motionQuery=typeof window!=='undefined'?window.matchMedia?.('(prefers-reduced-motion: reduce)'):undefined;this._applyQuality();
  this.scene=new T.Scene();this.scene.background=new T.Color('#090f17');this.scene.fog=new T.FogExp2('#090f17',.018);this.camera=new T.PerspectiveCamera(82,1,.08,220);this.camera.rotation.order='YXZ';this.scene.add(new T.HemisphereLight('#b2eeff','#1f252c',2));const sun=new T.DirectionalLight('#c9e5ef',2.8);sun.position.set(3,12,8);sun.castShadow=this.renderer.isSoftware!==true;if(sun.shadow){const shadowSize=this.qualitySettings?.shadowMap??2048;sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.bias=-.0006;sun.shadow.normalBias=.03;}this.sun=sun;this.sunTarget=new T.Object3D();this.scene.add(this.sunTarget);sun.target=this.sunTarget;this.scene.add(sun);
  if(this.renderer.isSoftware!==true&&this.renderer.shadowMap){this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;this.renderer.shadowMap.needsUpdate=true;}
  if(this.renderer.isSoftware!==true&&this.renderer.capabilities&&typeof document!=='undefined'){try{const pmrem=new T.PMREMGenerator(this.renderer);this.environmentRT=pmrem.fromScene(new RoomEnvironment(),.04);this.scene.environment=this.environmentRT.texture;this.scene.environmentIntensity=.5;pmrem.dispose();}catch{}}
      this.renderResources=new Set();this.sharedResources=new Set();this.modelAssets=new ModelAssets();this.buildArena();this.actorModels=new Map();this.vehicleModels=new Map();this.pickupModels=[];this.flagModels=new Map();this.lastEvent=0;this.flashUntil=0;this.playerId=0;this.spectator=false;this.spectatorTarget=null;this.spectatorThird=false;this.hands=new T.Group();
   // First-person weapons render through a dedicated scene + camera so the gun
   // keeps normal depth testing between its own parts while never being clipped
   // by world depth. A mirrored root keeps muzzle world transforms correct for
   // effects. The CPU renderer keeps the legacy in-camera path.
   this.weaponScene=null;this.weaponRoot=null;this.weaponCamera=null;this.weaponFov=Math.max(45,Number(this.display?.fov)||70);
   if(this.renderer.isSoftware===true){this.camera.add(this.hands);}
   else{this.weaponScene=new T.Scene();this.weaponRoot=new T.Group();this.weaponScene.add(this.weaponRoot);this.weaponRoot.add(this.hands);this.weaponCamera=new T.PerspectiveCamera(this.weaponFov,1,.02,4);this.weaponScene.add(new T.HemisphereLight('#cfe9ff','#20262c',2.2));const weaponKey=new T.DirectionalLight('#ffffff',2.6);weaponKey.position.set(-2,4,3);this.weaponScene.add(weaponKey);}
   this.scene.add(this.camera);this.currentWeapon=-1;this._weaponCache=new Map();this.aim=false;this.lowHealth=false;this.cameraShake=new CameraShake();this.muzzleLights=null;this.lowHealthOverlay=null;this.railPool=null;this.deathPool=null;this.deathContext=new Map();this.payloadModel=null;this.decalPool=null;this.ambientFx=null;this.ambientPool=null;this.ambientConfig=null;this.ambientAnchors=[];this.scatterWind=[];this.killcamEnabled=true;this._killcam=null;this.hitPool=null;this.hitFlinch=new Map();this._lightning=[];this._lightningAt=0;this._flash=0;this._wetSheenApplied=0;this.preview=null;this.showcaseExpected=false;if(this.renderer.isSoftware!==true){this.muzzleLights=new MuzzleLightPool(this.scene,2);this.lowHealthOverlay=new LowHealthOverlay(this.camera);if(typeof document!=='undefined')this.railPool=new RailBeamPool(this.scene,6);this.decalPool=new DecalPool(this.scene,18);const rim=new T.DirectionalLight('#7fd8ff',.55);rim.position.set(-7,6,-9);rim.userData.rimLight=true;this.scene.add(rim);}this.menu=this.makeMenu();this.cinema=false;this.director=null;this._cameraOwner='auto';this._freeCam=false;this._directorLock=false;this.manualFollowId=null;this.freePose={x:0,y:6,z:0,yaw:0,pitch:0};this.freeSpeed=FREE_CAM_DEFAULT_SPEED;this.freeBoost=FREE_CAM_BOOST;this._freeVel=null;this._freeExit=null;this._freeExitPose=null;this._lastMode=null;this.showcaseState=null;this.previewRect=null;this.raycaster=new T.Raycaster();this._occClear=0;this.resize();}
       reduced(){return reducedMotion(this.display?.reducedMotion, Boolean(this.motionQuery?.matches));}
       // Presentation-only quality tier. Lazily resolved so partially constructed
       // views in tests still get a sane budget, and cached so hot paths are free.
       _quality(){if(this.qualitySettings)return this.qualitySettings;return this._applyQuality();}
       _applyQuality(){
        const software=this.renderer?.isSoftware===true,reduced=this.reduced()===true;
        const ceiling=normalizeQuality(this._qualityOverride,{software,reduced}),ceilingIndex=qualityIndex(ceiling,{software});
        // Auto quality may sit below the ceiling after a slow spell but never
        // climbs above it; a pinned override forces exactly the requested tier.
        let index=ceilingIndex;
        if(this._qualityOverride==null&&this.quality!=null){const current=qualityIndex(this.quality,{software});if(current>=0)index=Math.min(current,ceilingIndex);}
        const tier=QUALITY_LEVELS[index]??ceiling;
        const next=qualitySettings(tier,{software,reduced});
        // Resource changes are keyed on the resolved tier. `_applyQuality` runs on
        // every display sync, so re-selecting the same tier must not resize
        // shadow targets or rebuild the composer.
        const changed=next!==this.qualitySettings;
        this.quality=tier;this.qualitySettings=next;
        if(this.perf){this.perf.tier=tier;this.perf.qualityAuto=this._qualityOverride==null;this.perf.reduced=reduced;}
        if(changed)this._onQualityChange();
        return this.qualitySettings;
       }
       _onQualityChange(){
        const q=this.qualitySettings||qualitySettings(this.quality??'high'),software=this.renderer?.isSoftware===true;
        // Changing shadow.mapSize alone does not resize an already-created render
        // target in this three revision: dispose it so three allocates the new
        // size on the next shadow pass, and request exactly one shadow refresh.
        if(this.sun?.shadow){
         const size=q.shadowMap??2048;
         if(this._shadowMapSize!==size){this._shadowMapSize=size;if(this.sun.shadow.map){this.sun.shadow.map.dispose?.();this.sun.shadow.map=null;}this.sun.shadow.mapSize.set(size,size);if(this.renderer?.shadowMap)this.renderer.shadowMap.needsUpdate=true;}
        }
        if(this.renderer?.setScreenArea)this.renderer.setScreenArea(q.tier===0?.12:q.tier===1?.09:.06);
        this._applyEffectsQuality();
        // The CPU renderer gets a hard per-frame triangle ceiling taken from the
        // active tier; WebGL lowers real geometry detail through _applyModelDetail.
        if(software&&this.renderer.setTriangleBudget)this.renderer.setTriangleBudget(frameTriangleBudget(this.quality,{software:true}));
        this._applyPostQuality();
        this._applyModelDetail();
       }
       // The separate effects-quality control scales particle/decal budgets on top
       // of the active tier, independent of the overall quality tier.
       _effectsScaleValue(level=this.display?.effectsQuality){return level==='low'?.4:level==='medium'?.7:level==='high'?1.15:1;}
       _applyEffectsQuality(){
        const s=this._effectsScaleValue(),q=this.qualitySettings||{};
        this._effectsScale=s;
        if(this.ambientFx)this.ambientFx.moteCap=Math.max(1,Math.round((q.ambientMotes??3)*s));
        if(this.weatherFx)this.weatherFx.cap=Math.max(2,Math.round((q.ambientMotes??3)*2*s));
       }
       // Enable/disable whole post passes and set the independent bloom budget
       // without touching the world render resolution.
       _applyPostQuality(){
        // Called from _onQualityChange, which also runs during construction
        // before the scene/camera exist; skip until the render graph is ready.
        if(!this.composer&&(!this.scene||!this.camera))return;
        const q=this.qualitySettings||{};
        this._syncPost();
        if(this.bloomPass)this.bloomPass.strength=Number(this.display?.bloom)*Number(q.bloom);
       }
       // Real WebGL geometry LOD: hide low-value detail meshes on distant or
       // low-tier models. The authoritative simulation and collision never see
       // this; only presentation toggles visibility.
       _applyModelDetail(){
        const detail=this.qualitySettings?.modelDetail??1;
        for(const model of this.actorModels?.values?.()||[])this._setModelDetail(model,detail,distanceOf(model,this.camera));
       }
       setQuality(level){this._qualityOverride=normalizeQualityOverride(level);return this._applyQuality();}
       qualityTier(){return this._quality().tier;}
       // Sustained-threshold, cooled-down auto quality. Pinned quality (an
       // explicit override) disables the controller entirely so a slow machine
       // never fights the player's choice; software stays at low.
       _sampleQuality(delta){
        if(this._qualityOverride!=null)return this.quality;
        const dt=Number.isFinite(delta)?delta:0;
        let sampled=false;
        if(dt>0){const f=this._fps??(this._fps={frames:0,elapsed:0,value:60});f.frames++;f.elapsed+=Math.min(dt,1);if(f.elapsed>=.5){f.value=f.frames/f.elapsed;f.frames=0;f.elapsed=0;sampled=true;}}
        if(dt>0&&dt<=.25)pushFrameTime(this._frameWindow,dt*1000);
        if(sampled&&this.dynamicResolution!==false){const d=this._drs??(this._drs={scale:1,cool:0});const frameMs=this._fps?.value>0?1000/this._fps.value:0;const next=nextDynamicScale(d,{frameMs,elapsedMs:500});const changed=next.scale!==d.scale;this._drs=next;if(changed)this.resize();}
        const software=this.renderer?.isSoftware===true,reduced=this.reduced()===true,ceiling=normalizeQuality(undefined,{software,reduced});
        const state=this._qualityState??(this._qualityState={level:null,bad:0,good:0,cool:0});
        if(!QUALITY_LEVELS.includes(state.level))state.level=this.quality??ceiling;
        const next=nextQualityState(state,dt*1000,{ceiling,software});
        state.level=next.level;state.bad=next.bad;state.good=next.good;state.cool=next.cool;
        if(next.changed&&next.level!==this.quality){this.quality=next.level;this.qualitySettings=qualitySettings(next.level,{software,reduced});this._onQualityChange();}
        const [median,p95]=framePercentiles(this._frameWindow,[.5,.95]);
        if(this.perf){this.perf.medianFrameMs=median;this.perf.p95FrameMs=p95;this.perf.lastFrameMs=dt*1000;}
        return this.quality;
       }
        setDisplay(prefs){if(prefs&&typeof prefs==='object'&&'quality' in prefs)this._qualityOverride=normalizeQualityOverride(prefs.quality);const display=normalizeDisplay(prefs),scaleChanged=display.resolutionScale!==this.display?.resolutionScale||display.resolutionCap!==this.display?.resolutionCap;this.display=display;this.camera.fov=display.fov;this.camera.updateProjectionMatrix();this.weaponFov=Math.max(45,Number(display.fov)||this.weaponFov||70);if(this.weaponCamera)this.weaponCamera.fov=this.weaponFov;this.showWeapon=display.showWeapon;if('toneMappingExposure' in this.renderer)this.renderer.toneMappingExposure=Number(display.exposure)||1.15;this._applyQuality();this._applyEffectsQuality?.();if(scaleChanged)this.resize();else this._syncPost?.();}
   setPlayerId(id){if(this.playerId!==id){this.feedback?.reset();this.flashUntil=0;this.cameraShake?.reset();this.lowHealth=false;}this.playerId=id;}
   setAim(on){this.aim=on===true;}
   setDynamicResolution(on){this.dynamicResolution=on!==false;this._drs={scale:1,cool:0};this.resize();return this.dynamicResolution;}
   // Presentation interpolation between fixed simulation ticks. `alpha` is the
   // fixed-step accumulator fraction (leftover / dt). Passing {enabled:false} or
   // alpha 1 restores direct authoritative rendering. This never mutates the
   // simulation and is meant only for the local fixed-step path.
   setInterpolation(value){
    if(value&&typeof value==='object'){if('enabled' in value)this._interpEnabled=value.enabled===true;if('alpha' in value)this._interpAlpha=Number.isFinite(value.alpha)?Math.max(0,Math.min(1,value.alpha)):1;}
    else if(typeof value==='number')this._interpAlpha=Math.max(0,Math.min(1,value));
    else if(typeof value==='boolean')this._interpEnabled=value;
    if(!this._interpEnabled)this._interpAlpha=1;
    return this._interpEnabled?this._interpAlpha:1;
   }
   // Capture a presentation snapshot for the tick that just simulated. Call this
   // once after every fixed step (including catch-up steps) so the two snapshots
   // always bracket the same 1/60 s of simulation. Storage is swapped, not
   // reallocated: the two Maps/slices are reused forever.
   capturePresentation(match){
    if(!match)return null;
    const p=this._presentState();
    const prevCur=p.cur;p.cur=p.prev;p.prev=prevCur;p.cur.clear();
    for(const a of match.actors||[])p.cur.set(a.id,{x:a.x||0,y:a.y||0,z:a.z||0,yaw:Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0)});
    const v=p.vehicles,prevVeh=v.cur;v.cur=v.prev;v.prev=prevVeh;v.cur.clear();
    for(const vehicle of match.vehicles||[]){const pos=vehicle.position||vehicle;v.cur.set(vehicle.id,{x:pos.x||0,y:pos.y||0,z:pos.z||0,yaw:vehicle.yaw??vehicle.heading??0,roll:vehicle.roll??0,pitch:vehicle.pitchBody??vehicle.pitch??0});}
    const r=p.rockets,prevRockets=r.cur;r.cur=r.prev;r.prev=prevRockets;r.cur.length=0;
    for(const rocket of match.rockets||[]){const pos=rocket?.pos||{};r.cur.push({x:pos.x||0,y:pos.y||0,z:pos.z||0});}
    p.time=Number.isFinite(match.time)?match.time:null;
    return p.cur.size;
   }
   // Clear interpolation history on match/map changes, respawns, teleports,
   // actor replacement, vehicle transitions and replay seeking. The first frame
   // after a reset snaps instead of sweeping from a stale pose.
   resetPresentation(){
    const p=this._presentState();
    p.cur.clear();p.prev.clear();p.vehicles.cur.clear();p.vehicles.prev.clear();p.rockets.cur.length=0;p.rockets.prev.length=0;p.time=null;
    return p;
   }
   // Lazily create the snapshot store so partially constructed views in tests (and
   // a view whose constructor path changed) never dereference undefined.
   _presentState(){return this._present??(this._present={cur:new Map(),prev:new Map(),vehicles:{cur:new Map(),prev:new Map()},rockets:{cur:[],prev:[]},time:null});}
   _presentPose(cur,prev,alpha){if(!cur)return null;return interpolatePose(prev||null,cur,alpha);}
   _presentActor(id){const p=this._presentState();return this._presentPose(p.cur.get(id),p.prev.get(id),this._interpAlpha);}
   _presentVehicle(id){const p=this._presentState();return this._presentPose(p.vehicles.cur.get(id),p.vehicles.prev.get(id),this._interpAlpha);}
   _presentRocket(index){const p=this._presentState();const c=p.rockets.cur[index];if(!c)return null;return interpolatePose(p.rockets.prev[index]||null,c,this._interpAlpha);}
   // The sight the camera is currently solving for, resolved from the weapon's
   // built-in sight and any mounted optic. Shared with the HUD so reticle style
   // and magnification can never disagree.
   getActiveSight(){return this._activeSight||resolveActiveSight({aiming:this.aim===true});}
   // Prepare the selected arena and initial weapon before the first gameplay
   // frame: build the requested viewmodel, make sure the post-processing variants
   // for the active display/quality exist, then compile world + viewmodel shaders.
   // The compile is bounded so a misbehaving renderer can never hang the match;
   // failures are reported in the result rather than treated as success.
   // Serialize shader warmup/preparation so two three.js compileAsync passes can
   // never poll the same program list concurrently (which logs a spurious
   // `isReady` TypeError). Failures never break the chain.
   _queueWarmup(task){
    const chain=this._warmupChain??(this._warmupChain=Promise.resolve());
    const run=chain.then(()=>task());
    this._warmupChain=run.then(()=>undefined,()=>undefined);
    return run;
   }
   async prepareScene(options={}){return this._queueWarmup(()=>this._prepareScene(options));}
   async _prepareScene({weapon=0,visual=null,finish=null,timeout=2500}={}){
    const startedAt=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    const result={ok:false,compiled:false,reason:null,ms:0};
    const elapsed=()=>((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())-startedAt;
    if(this.renderer?.isSoftware===true){result.ok=true;result.reason='software';result.ms=elapsed();return result;}
    try{
     if(Number.isInteger(weapon))try{this._acquireWeapon(weapon,visual,finish);}catch{}
     try{this._applyPostQuality?.();}catch{}
     // Synchronous compile is deliberate: three's `compileAsync` polls
     // `materialProperties.currentProgram`, which is undefined for some materials
     // (e.g. transparent effect materials), logging an `isReady` TypeError and
     // never resolving. A synchronous compile is bounded by the surrounding
     // preparing state and cannot flood or hang. The timeout still applies to a
     // renderer whose compile is slow or throws.
     const ok=await this._compileScenes(Number(timeout)||2500);
     if(ok==='timeout'){result.reason='timeout';}
     else{result.compiled=ok===true;result.ok=ok===true;if(!ok)result.reason='no-compile-method';}
    }catch(error){result.reason=String(error?.message||error||'warmup failed');}
    result.ms=elapsed();
    return result;
   }
   // Compile the world and viewmodel scenes, preferring the synchronous compile
   // (bounded by a timeout so a slow renderer cannot wedge scene preparation).
   async _compileScenes(timeout=2500){
    const run=()=>{
     if(typeof this.renderer?.compile!=='function')return false;
     this.renderer.compile(this.scene,this.camera);
     if(this.weaponScene&&this.weaponCamera)this.renderer.compile(this.weaponScene,this.weaponCamera);
     return true;
    };
    return Promise.race([Promise.resolve().then(run),new Promise(resolve=>setTimeout(()=>resolve('timeout'),Math.max(400,timeout)))]);
   }
   // Warm shader variants for the world and viewmodel scenes during loading.
   // A no-op on the CPU renderer; safe to call repeatedly and never rejects.
   async warmup(){return this._queueWarmup(()=>this._warmupWorld());}
   async _warmupWorld(){
    if(this.renderer?.isSoftware===true)return false;
    try{
     if(typeof this.renderer?.compile==='function'){
      this.renderer.compile(this.scene,this.camera);
      if(this.weaponScene&&this.weaponCamera)this.renderer.compile(this.weaponScene,this.weaponCamera);
      return true;
     }
    }catch{}
    return false;
   }
   setSpectator(on){this.spectator=on===true;}
  setSpectatorTarget(id){this.spectatorTarget=Number.isInteger(id)?id:null;}
  setSpectatorThird(value){this.spectatorThird=value===true;}
   // Switching the cinema off hands ownership back to `auto` and drops every
   // cached camera state so the next frame starts clean.
   setCinema(on){this.cinema=on===true;if(!this.cinema){this._camWant=undefined;this._raceCam=undefined;this._freeExit=null;this._freeCam=false;this._directorLock=false;this.clearFreeMotion();if(this.cameraOwner!=='auto')this._setCameraOwner('auto');this.resetFreeCam();}}
   setDirector(director){this.director=director||null;}
   // Ownership. `setCameraOwner` is the explicit runtime switch; entering `free`
   // routes through setFreeCam so the pose is seeded from the live camera, and
   // leaving `free` routes through the graceful hand-off.
   setCameraOwner(owner){
    const next=normalizeCameraOwner(owner);
    if(next==='free'){this.setFreeCam(true);return 'free';}
    if(this._freeCam||this.cameraOwner==='free')return this._leaveFreeCam(next);
    this._setCameraOwner(next);
    return next;
   }
   get cameraOwner(){return normalizeCameraOwner(this._cameraOwner);}
   _setCameraOwner(owner){
    const next=normalizeCameraOwner(owner);
    if(next!==this.cameraOwner){this._camWant=undefined;this._raceCam=undefined;}
    this._cameraOwner=next;
    if(next!=='free'){this._freeCam=false;this.clearFreeMotion();}
    return next;
   }
   // Free roam. Enabling seeds from the CURRENT camera pose (position + YXZ
   // yaw/pitch), never from the world origin or a stored seed; a repeated enable
   // while already free keeps the pose. Disabling hands the camera back to the
   // next shot with a damped transition when a director is present, instead of
   // snapping.
   setFreeCam(on){
    const next=on===true;
    if(next){
     if(!this._freeCam||this.cameraOwner!=='free'){
      this._seedFreePose();
      this._freeExit=null;
      this._setCameraOwner('free');
      this._freeCam=true;
     }
     return true;
    }
    if(this._freeCam||this.cameraOwner==='free')this._leaveFreeCam();
    else this.clearFreeMotion();
    return false;
   }
   _seedFreePose(){
    const pose=this.freePose??(this.freePose={x:0,y:6,z:0,yaw:0,pitch:0});
    const position=this.camera?.position,rotation=this.camera?.rotation;
    if(Number.isFinite(position?.x))pose.x=position.x;
    if(Number.isFinite(position?.y))pose.y=position.y;
    if(Number.isFinite(position?.z))pose.z=position.z;
    if(Number.isFinite(rotation?.y))pose.yaw=rotation.y;
    if(Number.isFinite(rotation?.x))pose.pitch=rotation.x;
    pose.x=Number.isFinite(pose.x)?pose.x:0;pose.y=Number.isFinite(pose.y)?pose.y:6;pose.z=Number.isFinite(pose.z)?pose.z:0;
    pose.yaw=Number.isFinite(pose.yaw)?pose.yaw:0;pose.pitch=Number.isFinite(pose.pitch)?pose.pitch:0;
    return pose;
   }
   // Hand the camera to the automatic controller. When a director is present the
   // exit pose is retained and blended into the next shot (slower under reduced
   // motion); the director is asked to reframe so it does not resume a stale
   // plan. Without a director the next controller takes over immediately.
   _leaveFreeCam(forced=null){
    const next=forced??(this.manualFollowId!=null?'manual':'auto');
    const pose=this.freePose,position=this.camera?.position,rotation=this.camera?.rotation;
    this._freeCam=false;
    this._setCameraOwner(next);
    this.clearFreeMotion();
    if(this.director){
     const exit=this._freeExitPose??(this._freeExitPose={x:0,y:6,z:0,yaw:0,pitch:0});
     exit.x=Number.isFinite(pose?.x)?pose.x:(Number.isFinite(position?.x)?position.x:(Number.isFinite(exit.x)?exit.x:0));
     exit.y=Number.isFinite(pose?.y)?pose.y:(Number.isFinite(position?.y)?position.y:(Number.isFinite(exit.y)?exit.y:6));
     exit.z=Number.isFinite(pose?.z)?pose.z:(Number.isFinite(position?.z)?position.z:(Number.isFinite(exit.z)?exit.z:0));
     exit.yaw=Number.isFinite(pose?.yaw)?pose.yaw:(Number.isFinite(rotation?.y)?rotation.y:0);
     exit.pitch=Number.isFinite(pose?.pitch)?pose.pitch:(Number.isFinite(rotation?.x)?rotation.x:0);
     this._freeExit=exit;
     // `reframe()` is called without a state: the next update re-resolves the
     // arena and actors, so a stale match can never be adopted by the director.
     if(next==='auto')this.director.reframe?.();
    }else this._freeExit=null;
    return next;
   }
   // Exponential damp from the free-exit pose into whatever the owning
   // controller wrote this frame. Ends when the error is negligible; a no-op
   // when no hand-off is pending. Reduced motion reframes more slowly so the
   // transition stays gentle instead of whipping.
   _applyFreeExitBlend(dt,reduced){
    const from=this._freeExit;if(!from)return false;
    const step=Math.min(Math.max(Number(dt)||0,0),.1),half=reduced?.45:.08;
    const k=smoothFactor(half,step),p=this.camera.position,r=this.camera.rotation;
    const ex=p.x-from.x,ey=p.y-from.y,ez=p.z-from.z;
    if(Math.hypot(ex,ey,ez)<.05){this._freeExit=null;return false;}
    from.x+=ex*k;from.y+=ey*k;from.z+=ez*k;
    from.yaw=smoothAngle(from.yaw,r.y,{halfLife:half,dt:step});
    from.pitch=smoothTowards(from.pitch,r.x,{halfLife:half,dt:step});
    p.set(from.x,from.y,from.z);r.set(from.pitch,from.yaw,0,'YXZ');
    return true;
   }
   // Manual subject follow. Reuses the spectator target (non-cinematic eye /
   // third-person path) and the director target (cinematic framing) so the page
   // never has to reproduce camera math. Claiming `manual` keeps the race demo
   // from clobbering the followed subject.
   setManualFollow(actorId){
    if(actorId==null){this.clearManualFollow();return null;}
    if(!Number.isInteger(actorId))return this.manualFollowId??null;
    this.manualFollowId=actorId;
    this.spectatorTarget=actorId;
    this.director?.setTarget?.(actorId);
    if(this._freeCam||this.cameraOwner==='free')this._leaveFreeCam('manual');
    else this._setCameraOwner('manual');
    return actorId;
   }
   clearManualFollow(){
    this.manualFollowId=null;
    this.director?.setTarget?.(null);
    if(this.cameraOwner==='manual')this._setCameraOwner('auto');
    return null;
   }
   get manualFollow(){return this.manualFollowId??null;}
   setDirectorLock(on){this._directorLock=on===true;}
   get freeCam(){return this._freeCam===true;}
   get directorLock(){return this._directorLock===true;}
   // Reframe free roam onto a useful pose: the nearest subject (the followed /
   // local player first, otherwise the closest actor to the camera), else the
   // arena centre. With no context at all it falls back to the historic origin
   // seed, so a bare view keeps its old behaviour. An explicit focus may be
   // passed by hosts that already know the subject.
   resetFreeCam(focus=null){
    this.clearFreeMotion();
    const subject=focus??this._freeCamFocus();
    if(!subject){this.freePose={x:0,y:6,z:0,yaw:0,pitch:0};return this.freePose;}
    const yaw=Number.isFinite(subject.yaw)?subject.yaw:0,height=6,distance=8;
    const x=(Number.isFinite(subject.x)?subject.x:0)+Math.sin(yaw)*distance;
    const y=(Number.isFinite(subject.y)?subject.y:0)+height;
    const z=(Number.isFinite(subject.z)?subject.z:0)+Math.cos(yaw)*distance;
    this.freePose={x,y,z,yaw,pitch:-Math.atan2(height,distance)};
    return this.freePose;
   }
   _freeCamFocus(){
    const models=this.actorModels;
    if(models&&typeof models.get==='function'){
     for(const id of [this.manualFollowId,this.spectatorTarget,this.playerId]){
      if(id==null)continue;
      const model=models.get(id),position=model?.position;
      if(position&&Number.isFinite(position.x)&&Number.isFinite(position.z))return {x:position.x,y:position.y,z:position.z,yaw:model.rotation?.y};
     }
     const camera=this.camera?.position;
     let best=null,bestDistance=Infinity;
     for(const model of models.values()){
      const position=model?.position;
      if(!position||!Number.isFinite(position.x)||!Number.isFinite(position.z))continue;
      const distance=camera?Math.hypot(position.x-camera.x,position.z-camera.z):0;
      if(distance<bestDistance){bestDistance=distance;best={x:position.x,y:position.y,z:position.z,yaw:model.rotation?.y};}
     }
     if(best)return best;
    }
    const arena=this.showcaseState?.arena??(typeof this.mapId==='string'?MAPS.find(map=>map.id===this.mapId):null);
    const bounds=arena?.bounds;
    if(bounds&&Number.isFinite(bounds.minX)&&Number.isFinite(bounds.maxX)&&Number.isFinite(bounds.minZ)&&Number.isFinite(bounds.maxZ))return {x:(bounds.minX+bounds.maxX)/2,y:0,z:(bounds.minZ+bounds.maxZ)/2,yaw:0};
    if(arena&&Number.isFinite(arena.center?.x)&&Number.isFinite(arena.center?.z))return {x:arena.center.x,y:Number.isFinite(arena.center?.y)?arena.center.y:0,z:arena.center.z,yaw:0};
    return null;
   }
   freeLook(dyaw,dpitch){const pose=this.freePose??(this.freePose={x:0,y:6,z:0,yaw:0,pitch:0});pose.yaw=(Number.isFinite(pose.yaw)?pose.yaw:0)+(Number.isFinite(dyaw)?dyaw:0);pose.pitch=Math.max(-1.5,Math.min(1.5,(Number.isFinite(pose.pitch)?pose.pitch:0)+(Number.isFinite(dpitch)?dpitch:0)));}
   // Free-roam movement driven by the page's movement bindings. Frame-rate
   // independent acceleration, a settable base speed and a boost multiplier; the
   // pose is mutated in place and the velocity is a reused scratch vector, so a
   // frame allocates nothing. Movement is only integrated while free roam owns
   // the camera, so a stray input frame can never move a non-free camera.
   freeMove(input,dt){
    const pose=this.freePose??(this.freePose={x:0,y:6,z:0,yaw:0,pitch:0});
    if(!(this._freeCam===true&&this.cameraOwner==='free')){this.clearFreeMotion();return pose;}
    const velocity=this._freeVel??(this._freeVel={x:0,y:0,z:0});
    return integrateFreeMove(pose,velocity,input,dt,this.freeCamSpeed,this.freeCamBoost);
   }
   // Drop all movement state (velocity) so nothing carries across Escape, blur
   // or a camera-mode switch. Safe to call at any time.
   clearFreeMotion(){
    if(this._freeVel){this._freeVel.x=0;this._freeVel.y=0;this._freeVel.z=0;}
    return this;
   }
   get freeCamSpeed(){return Number.isFinite(this.freeSpeed)?this.freeSpeed:FREE_CAM_DEFAULT_SPEED;}
   setFreeCamSpeed(speed){this.freeSpeed=Number.isFinite(speed)?Math.max(FREE_CAM_MIN_SPEED,Math.min(FREE_CAM_MAX_BASE_SPEED,speed)):FREE_CAM_DEFAULT_SPEED;this.clearFreeMotion();return this.freeCamSpeed;}
   get freeCamBoost(){return Number.isFinite(this.freeBoost)?this.freeBoost:FREE_CAM_BOOST;}
   setFreeCamBoost(scale){this.freeBoost=Number.isFinite(scale)?Math.max(1,Math.min(4,scale)):FREE_CAM_BOOST;this.clearFreeMotion();return this.freeCamBoost;}
   // Legacy instant-velocity free flight kept for existing page wiring and the
   // pinned tests. New hosts should drive freeMove() so acceleration, speed
   // clamping and mode-change input safety apply.
   updateFreeCam(dt,{forward=0,right=0,up=0,boost=false}={}){const pose=this.freePose??(this.freePose={x:0,y:6,z:0,yaw:0,pitch:0});const step=Math.min(Math.max(Number.isFinite(dt)?dt:0,0),.1),speed=16*(boost===true?2.4:1),fwd=Number.isFinite(forward)?forward:0,strafe=Number.isFinite(right)?right:0,rise=Number.isFinite(up)?up:0,cy=Math.cos(pose.yaw||0),sy=Math.sin(pose.yaw||0),cp=Math.cos(pose.pitch||0),sp=Math.sin(pose.pitch||0),distance=speed*step;pose.x+=distance*(fwd*(-cp*sy)+strafe*cy);pose.y+=distance*(fwd*sp+rise);pose.z+=distance*(fwd*(-cp*cy)+strafe*(-sy));if(!(pose.y>=.4))pose.y=.4;if(!Number.isFinite(pose.x))pose.x=0;if(!Number.isFinite(pose.z))pose.z=0;if(!Number.isFinite(pose.yaw))pose.yaw=0;if(!Number.isFinite(pose.pitch))pose.pitch=0;return pose;}
    setShowcase(state){this.showcaseState=state||null;}
    // Mark whether a live menu showcase is expected. When true, a frame that
    // arrives before the first showcase snapshot renders the arena scene instead
    // of the full-screen operator turntable, so the demo background never
    // flashes the model preview during a scenario swap.
    setShowcaseExpected(value){this.showcaseExpected=value===true;}
    setPreviewRect(rect){this.previewRect=rect||null;}
    // ---- Weapon inspect API (menu/showcase) --------------------------------
    // Mount a rotating, inspectable weapon preview. The host screen supplies a
    // mount rect (CSS pixels) and, optionally, its own ModelAssets so preview
    // and gameplay share resources. Returns the rig so the host can drive it.
    mountWeaponPreview({type=0,visual=null,finish=null,rect=null,assets=null}={}){
     if(!assets&&!this.previewAssets)this.previewAssets=new ModelAssets();
     const rig=this.preview??(this.preview=createWeaponPreview({assets:assets??this.previewAssets}));
     this.previewRect=rect??this.previewRect;
     rig.mount({type,visual,finish});
     if(this.previewRect)rig.resize(this.previewRect.width,this.previewRect.height);
     return rig;
    }
    // Advance the preview turntable and render it into the mount rect. Safe to
    // call every frame; a missing rig or rect is a no-op.
    updateWeaponPreview(time,{reduced=this.reduced(),spin=.35,pitch=-.18,visible=true}={}){
     const rig=this.preview;if(!rig)return null;
     rig.setVisible(visible);
     rig.update(time,{reduced,spin,pitch});
     return rig;
    }
    unmountWeaponPreview(){this.preview?.clear();}
    // Render the mounted weapon preview into its mount rect. A host menu screen
    // calls this after updateWeaponPreview so the preview shares the single
    // WebGL context instead of creating a second renderer. Returns false when
    // there is nothing to draw (no rig, no rect, or a software renderer).
    renderWeaponPreview(){
     const rig=this.preview,rect=this.previewRect;
     if(!rig||!rect||rect.width<12||rect.height<12)return false;
     if(this.renderer?.isSoftware===true)return false;
     rig.resize(rect.width,rect.height);
     return this._renderSceneInto(this.renderer,rect,rig.scene,rig.camera);
    }
    // Scissor a scene into a CSS-pixel rect on the shared renderer, restoring the
    // full viewport afterwards. Used by both the character and weapon previews.
    _renderSceneInto(renderer,rect,scene,camera){
     const w=this.width,h=this.height;if(!(w>0&&h>0))return false;
     const x=Math.max(0,Math.round(rect.left)),y=Math.max(0,Math.round(h-rect.bottom)),vw=Math.max(1,Math.round(rect.width)),vh=Math.max(1,Math.round(rect.height));
     const prevAuto=renderer.autoClear;
     renderer.setScissorTest(true);renderer.setViewport(x,y,vw,vh);renderer.setScissor(x,y,vw,vh);renderer.autoClear=true;
     renderer.render(scene,camera);
     renderer.setScissorTest(false);renderer.setViewport(0,0,w,h);renderer.setScissor(0,0,w,h);renderer.autoClear=prevAuto;
     return true;
    }
    cinemaLook(dy,dp){this.director?.look?.(dy,dp);}
    resize(){const w=Math.max(1,this.renderer.domElement.clientWidth),h=Math.max(1,this.renderer.domElement.clientHeight),ratio=budgetedRatio({width:w,height:h,dpr:window.devicePixelRatio,scale:this.display?.resolutionScale??1,cap:this.display?.resolutionCap??'auto',software:this.renderer.isSoftware===true,dynamic:this._drs?.scale??1});
     if(this.width===w&&this.height===h&&this.pixelRatio===ratio){this._syncPost?.();return;}
     if(this.pixelRatio!==ratio)this.renderer.setPixelRatio(ratio);
     // Keep even tiny/hidden canvases at least one backing pixel without changing CSS size.
     this.renderer.setSize(Math.max(w,1/ratio),Math.max(h,1/ratio),false);this.width=w;this.height=h;this.pixelRatio=ratio;
     // Report the real drawing-buffer dimensions rather than assuming a monitor
     // resolution; a 100% world render is capped by the resolution budget (resolution.mjs).
     if(this.perf){const dom=this.renderer.domElement||{},dpr=window.devicePixelRatio;this.perf.viewport={cssWidth:w,cssHeight:h,devicePixelRatio:Number.isFinite(dpr)?dpr:1,bufferWidth:dom.width??Math.round(w*ratio),bufferHeight:dom.height??Math.round(h*ratio),scale:ratio};}
     this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.menu.camera.aspect=w/h;this.menu.camera.updateProjectionMatrix();if(this.weaponCamera){this.weaponCamera.aspect=w/h;this.weaponCamera.updateProjectionMatrix();}this._syncPost?.();}
     setGraphicsLab(prefs){this.graphicsLab=normalizeGraphicsLab(prefs);this._syncPost();}
          _syncPost(){
      const eligible=this.renderer instanceof T.WebGLRenderer,q=this.qualitySettings||this._quality();
      const base=postStage({eligible,reduced:this.reduced(),postFx:this.display?.postFx});
      const lab=eligible&&this.graphicsLab?.enabled===true;
      const bloomStrength=base?Number(this.display?.bloom)*Number(q.bloom):0;
      const want=base||lab;
      if(!want){if(this.composer){disposeComposer(this.composer);this.composer=null;this.bloomPass=null;this.vignettePass=null;this.aaPass=null;this.graphicsLabPass=null;this._postKey=null;}this._postW=0;this._postH=0;this._postRatio=0;return;}
     // A zero-strength bloom used to leave its expensive processing running. The
     // pass is now omitted entirely, and the vignette/FXAA passes follow the
     // quality tier, so the composed path only contains passes that do work.
      const key=`${bloomStrength>0?1:0}|${base&&q.vignette!==false?1:0}|${base&&q.fxaa!==false?1:0}|lab:${lab?1:0}`;
      if(this.composer&&this._postKey!==key){disposeComposer(this.composer);this.composer=null;this.bloomPass=null;this.vignettePass=null;this.aaPass=null;this.graphicsLabPass=null;}
     if(!this.composer){try{const composer=new EffectComposer(this.renderer);composer.addPass(new RenderPass(this.scene,this.camera));
      if(bloomStrength>0){this.bloomPass=new UnrealBloomPass(new T.Vector2(1,1),bloomStrength,.72,.9);composer.addPass(this.bloomPass);}
       if(base&&q.vignette!==false){const vignette=new ShaderPass(VignetteShader);vignette.uniforms.offset.value=1.05;vignette.uniforms.darkness.value=.92;composer.addPass(vignette);this.vignettePass=vignette;}
      composer.addPass(new OutputPass());
      // FXAA follows OutputPass (sRGB). The default framebuffer still requests
      // MSAA for the direct path and the post-composer weapon pass, so this pass
      // only covers the composer's non-MSAA render targets.
       if(base&&q.fxaa!==false){const aa=new ShaderPass(FXAAShader);aa.name='fxaa';composer.addPass(aa);this.aaPass=aa;}
       if(lab){this.graphicsLabPass=new GraphicsLabPass();composer.addPass(this.graphicsLabPass);}
      this.composer=composer;this._postKey=key;this._postW=0;this._postH=0;this._postRatio=0;}catch{this.composer=null;return;}}
     if(this.bloomPass)this.bloomPass.strength=bloomStrength;
      const w=Math.max(1,this.renderer.domElement.clientWidth),h=Math.max(1,this.renderer.domElement.clientHeight),ratio=this.pixelRatio??1;
      if(this.graphicsLabPass)this.graphicsLabPass.configure(this.graphicsLab,w,h);
     if(this._postW!==w||this._postH!==h||this._postRatio!==ratio){
      applyComposerSize(this.composer,w,h,ratio);
      // Independent bloom budget applied after composer resizing, so a resize can
      // never overwrite the cap with the full-resolution target.
      if(this.bloomPass){const budget=bloomResolution(w,h,{scale:q.bloomScale??.5,maxDim:q.bloomMax??1024});this.bloomPass.setSize?.(budget.width,budget.height);}
      if(this.aaPass)this.aaPass.uniforms.resolution.value.set(1/(w*ratio),1/(h*ratio));
      this._postW=w;this._postH=h;this._postRatio=ratio;
     }
    }
    buildArena(arena=MAPS[0]){return withAssets(this.arenaAssets??=new ModelAssets(),()=>this._buildArena(arena));}
    _buildArena(arena=MAPS[0]){this._disposeMothSprites();if(this.worldGroup){this.scene.remove(this.worldGroup);this.disposeObject(this.worldGroup);for(const resource of this.renderResources||[])resource.dispose();this.renderResources?.clear();this.flagAssets=null;}this.sky=null;this.mountains=null;this.objectiveModels=new Map();this._mothRift=null;this._mothRiftSheet=null;this.mapId=arena.id;this.viewAudio?.setSpace?.(mothSpaceFor(arena.id));this.viewAudio?.setEchoMap?.(mothEchoFor(arena.id));const world=new T.Group();this.worldGroup=world;this.scene.add(world);this.scene.background=new T.Color(arena.background);this.scene.fog=new T.FogExp2(arena.background,.018);const bounds=arenaBounds(arena),legacy=!arena.bounds,minX=bounds.minX,maxX=bounds.maxX,minZ=bounds.minZ,maxZ=bounds.maxZ,width=maxX-minX,depth=maxZ-minZ;
    const look=arenaLooks[arena.id]||arenaLooks.exchange,[floorColor,wallColor,trimColor,skyColor,groundColor,fogDensity,metal]=look;
    this.scene.fog.density=fogDensity;world.userData.look=arena.id;
    for(const light of this.scene.children){if(light.userData?.rimLight)continue;if(light.isHemisphereLight){light.color.set(skyColor);light.groundColor.set(groundColor);light.intensity=arena.terrain?2.5:1.8;}if(light.isDirectionalLight){light.color.set(skyColor);light.intensity=arena.terrain?3.1:2.4;light.position.set(arena.id==='aether'?-18:18,24,arena.id==='foundry'?-12:10);}}
    // Snapshot the authored look so weather/time-of-day tinting always lerps
    // from the arena's own values instead of accumulating frame to frame.
    const hemi=this.scene.children.find(light=>light.isHemisphereLight),sunLight=this.scene.children.find(light=>light.isDirectionalLight&&!light.userData?.rimLight);
    this._arenaLook={background:arena.background||'#0a0f1e',fog:arena.background||'#0a0f1e',fogDensity,sky:skyColor,ground:groundColor,metal,exposure:Number(this.display?.exposure)||1.15};
    this._arenaLight={hemi:hemi?.intensity??1.8,sun:sunLight?.intensity??2.4,hemiColor:new T.Color(hemi?.color||skyColor),sunColor:new T.Color(sunLight?.color||skyColor),groundColor:new T.Color(hemi?.groundColor||groundColor)};
    const floor=material(arena.floorColor??floorColor,metal,.78),wall=material(wallColor,metal,.72),trim=material(trimColor,metal,.58),glow=material(arena.color,.4,.3,true),islands=arena.platforms?.length>0;
    const palette=[floor,wall,trim,glow],detailBatches=new Map(),indexedUnit=new T.BoxGeometry(1,1,1),unit=indexedUnit.toNonIndexed();indexedUnit.dispose();
    const arenaSeed=arenaSeedOf(arena),textured=this.renderer?.isSoftware!==true&&typeof document!=='undefined';
    clearSurfaceTextures();
    const applyTextures=(mat,kind,rx,ry)=>this._mothSurface(mat,kind,rx,ry,arenaSeed);
    const variantBuckets={block:new Map(),detail:new Map(),terrain:new Map(),terrainWall:new Map()};
    const variant=(scope,base,{map=false,kind='rock'}={})=>{const bucket=variantBuckets[scope];let clone=bucket.get(base);if(!clone){clone=base.clone();clone.vertexColors=true;clone.map=null;clone.normalMap=null;clone.roughnessMap=null;if(map)applyTextures(clone,kind,1,1);bucket.set(base,clone);palette.push(clone);}return clone;};
    const floorKind=arena.id==='neon-vertical'||arena.id==='crosswire'?'holographic_grid':(arena.id==='foundry'?'diamond_plate':(['ironfall-megastructure','substation','citadel','derelict-station'].includes(arena.id)?'metal_grating':(['launchpad','catwalk-breach'].includes(arena.id)?'carbon_fiber':'weathered_concrete')));
    applyTextures(floor,floorKind,Math.max(2,Math.round(width/4)),Math.max(2,Math.round(depth/4)));
    // Moth Quantum signature: on the quantum labyrinth, build an iridescent
    // landmark from the entanglement LUTs and an animated rift from the baked
    // effect frames. The baked sky atmosphere is wired onto the standard sky
    // dome below (`MOTH_ATMOSPHERE_MAPS`), so it follows the camera and keeps
    // addSky's stars, sun disc and haze children.
    if(arena.id==='moth-backrooms'&&textured){
      const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;
      const riftFrames=mothEffectTextures('quantum-rift');
      if(this.renderer?.isWebGLRenderer===true){
        const lut=mothMaterialLutTexture('entanglement-arcane');
        const riftMat=createMothLutMaterial({lut,base:{color:'#0c171b',metalness:.72,roughness:.2,emissive:'#123238'},intensity:.95});
        const rift=new T.Mesh(new T.TorusKnotGeometry(2.1,.32,110,14),riftMat);
        rift.position.set(cx,3.4,cz);rift.castShadow=false;world.add(rift);this._mothRift=rift;
      }
      if(riftFrames?.textures?.length){const fxMat=new T.MeshBasicMaterial({map:riftFrames.textures[0],transparent:true,opacity:.65,blending:T.AdditiveBlending,depthWrite:false,side:T.DoubleSide,fog:false});const sheet=new T.Mesh(new T.PlaneGeometry(6,6),fxMat);sheet.position.set(cx,3.4,cz);world.add(sheet);this._mothRiftSheet={frames:riftFrames.textures,fps:riftFrames.fps||10,index:0,mat:fxMat,mesh:sheet};}
    }
    // Shadow camera fits the arena half-extent; the arena ground color keeps shadowed surfaces tinted.
    if(this.sun){const centerX=(minX+maxX)/2,centerZ=(minZ+maxZ)/2,extent=Math.max(width,depth)/2+10;this.sunTarget.position.set(centerX,0,centerZ);this.sun.position.set(centerX+(arena.id==='aether'?-18:18),26,centerZ+(arena.id==='foundry'?-12:12));if(this.sun.shadow){const shadowCamera=this.sun.shadow.camera;shadowCamera.left=-extent;shadowCamera.right=extent;shadowCamera.top=extent;shadowCamera.bottom=-extent;shadowCamera.near=.5;shadowCamera.far=extent*4+80;shadowCamera.updateProjectionMatrix();this.sun.shadow.bias=-.0006;this.sun.shadow.normalBias=.03;}}
    // Bake shallow cladding into a handful of ordinary meshes, not hundreds of draw calls.
    const detail=(w,h,d,x,y,z,rawMat)=>{if(Math.min(w,h,d)<=0)return;const mat=variant('detail',rawMat);let entry=detailBatches.get(mat);if(!entry){entry={positions:[]};detailBatches.set(mat,entry);}const p=unit.attributes.position,positions=entry.positions;for(let i=0;i<p.count;i++)positions.push(x+p.getX(i)*w,y+p.getY(i)*h,z+p.getZ(i)*d);};
   if(!islands&&!arena.terrain){
    // Subdivide the floor. On WebGL the tiles are merged into a single material
    // batch (one draw call instead of hundreds), preserving each tile's UVs,
    // normals and shadow receive. The CPU renderer keeps separate tiles because
    // its painter depth ordering needs the smaller surfaces.
    const tile=5,tiles=[];
    for(let x=minX+tile/2;x<maxX;x+=tile)for(let z=minZ+tile/2;z<maxZ;z+=tile)tiles.push({w:Math.min(tile,maxX-x+tile/2),d:Math.min(tile,maxZ-z+tile/2),x,z});
    const batchFloor=this.renderer?.isWebGLRenderer===true&&tiles.length>1;
    const batched=batchFloor?this._mergeFloorTiles(tiles,floor):null;
    if(batched)world.add(batched);
    else for(const t of tiles){const tileMesh=box(world,t.w,.5,t.d,t.x,-.25,t.z,floor);tileMesh.receiveShadow=true;}
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
    const addTerrainMesh=(triangles,side=false)=>{const scope=side?'terrainWall':'terrain',groups=new Map();for(const triangle of triangles){const key=triangle.material||'rock';const group=groups.get(key)||{positions:[],uvs:[]};const normal=triangle.normal,ax=Math.abs(normal[0]),ay=Math.abs(normal[1]),az=Math.abs(normal[2]);for(const point of triangle.vertices){group.positions.push(point[0],point[1],point[2]);if(ay>=ax&&ay>=az)group.uvs.push(point[0]*.22,point[2]*.22);else if(ax>=az)group.uvs.push(point[2]*.22,point[1]*.22);else group.uvs.push(point[0]*.22,point[1]*.22);}groups.set(key,group);}for(const [key,group] of groups){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(group.positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(group.uvs,2));geometry.setAttribute('normal',new T.Float32BufferAttribute(smoothNormals(group.positions,{angleCos:.82}),3));geometry.setAttribute('color',new T.Float32BufferAttribute(positionColors(group.positions,{seed:arenaSeed+key.length*37,jitter:.16}),3));const mat=variant(scope,terrainMaterials[key]||terrainMaterials.rock,{map:textured,kind:terrainTextureKind(key)});if(side&&mat.side!==T.DoubleSide)mat.side=T.DoubleSide;const mesh=new T.Mesh(geometry,mat);mesh.userData.terrain=true;mesh.castShadow=true;mesh.receiveShadow=true;world.add(mesh);}}
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
   const rock=arena.id==='blood-gulch'&&(['cover','landmark','rock','boulder'].includes(b.kind)),bunker=b.kind?.startsWith('base-')||b.kind==='cliff-outpost',raceMat=raceMats?.[b.kind];
   const blockKind=rock?'rock':(b.kind==='reactor'?'hazard_stripes':(bunker?'riveted_armor':(arena.id==='citadel'?'riveted_armor':(['ironfall-megastructure','substation'].includes(arena.id)?'metal_grating':(arena.id==='neon-vertical'||arena.id==='aether'?'hex_paneling':(arena.id==='foundry'?'hazard_stripes':'metal'))))));
   const blockMat=variant('block',raceMat??(rock?rockMat:wall),{map:textured&&!raceMat,kind:blockKind}),body=box(world,b.w,b.h,b.d,b.x,b.h/2,b.z,blockMat);paintGeometry(body.geometry,arenaSeed+index*13+1,.16);body.userData.block=index;body.castShadow=true;body.receiveShadow=true;
    // Rails are continuous collision runs of overlapping boxes; render the
    // smooth barrier walls in raceTrackModel instead so they never z-fight.
    if(raceMat){if(b.kind==='race-rail'||b.kind==='soccer-goal'){body.visible=false;body.castShadow=false;body.receiveShadow=false;}continue;}
   // Foundation tops already live in the authoritative terrain mesh. Keep the
   // solid's side skirt, but no coplanar top or unrelated legacy facade trim.
   if(arena.nextGen===true&&b.kind==='foundation'){
    const g=body.geometry.clone();body.geometry=g;this.renderResources.add(g);const index=g.index,indices=[];
    for(let i=0;i<index.count;i+=3)if(g.attributes.normal.getY(index.getX(i))<.5)indices.push(index.getX(i),index.getX(i+1),index.getX(i+2));
    g.setIndex(indices);continue;
   }
   // Next-gen maps keep these as invisible collision proxies and draw smooth geometry in buildNextGen.
   if(arena.nextGen===true&&NEXTGEN_PROXY.has(b.kind)){body.visible=false;continue;}
   // Foundry has its own restrained copper/ceramic kit pass below; stacking the
   // legacy full-height panels over it obscures doors and doubles the art bill.
   if(arena.foundry)continue;
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
   foundryDetails(world,arena,{detail,material,textLabel,palette,trim,glow});
   for(const [mat,entry] of detailBatches){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(entry.positions,3));geometry.computeVertexNormals();paintGeometry(geometry,arenaSeed+77,.14);const mesh=new T.Mesh(geometry,mat);mesh.userData.arenaDetail=true;mesh.receiveShadow=true;world.add(mesh);}unit.dispose();
 if(arena.raised){for(const x of [-11.05,11.05]){const length=Math.hypot(12,3.8),ramp=box(world,5.5,.18,length,x,1.83,-3,floor);ramp.rotation.x=Math.atan(3.8/12);for(const sx of [-2.2,2.2]){const strip=box(world,.06,.04,length,x+sx,1.96,-3,glow);strip.rotation.x=Math.atan(3.8/12);}}box(world,27,.06,.07,0,3.84,-9,glow);}
 if(arena.id==='crosswire'){for(const x of [-1.6,1.6])box(world,.055,.03,26,x,.04,0,glow);for(const z of [-1.6,1.6])box(world,26,.03,.055,0,.04,z,glow);ring(world,2,.025,0,6.2,0,glow);}
 if(arena.id==='exchange')for(const y of [.25,3.5,5.5])ring(world,2.1,.055,0,y,0,glow);
 if(arena.id==='foundry')for(const x of [-4,4]){for(const z of [-2,0,2])box(world,1.8,.03,.35,x,5.77,z,glow);textLabel(world,'HOT',x,4,2.52,.35,'#ffc684');}
    if(!islands&&!arena.terrain){const edge=legacy?13.94:maxX-.06;textLabel(world,arena.name.toUpperCase(),(minX+maxX)/2,6.5,minZ+.06,1.3);textLabel(world,'02',minX+.06,5.8,(minZ+maxZ)/2,1.2,arena.color,Math.PI/2);textLabel(world,'01',maxX-.06,5.8,(minZ+maxZ)/2,1.2,arena.color,-Math.PI/2);for(const x of legacy?[-7,7]:[(minX+maxX)/2-width*.25,(minX+maxX)/2+width])box(world,.07,.04,depth*.77,x,.06,(minZ+maxZ)/2,glow);for(const z of legacy?[-10,0,10]:[minZ+depth/6,(minZ+maxZ)/2,maxZ-depth/6]){box(world,width,.3,.35,(minX+maxX)/2,8.5,z,trim);box(world,width*.72,.05,.15,(minX+maxX)/2,8.32,z,glow);}for(const x of legacy?[-12,12]:[minX+2,maxX-2]){const light=new T.PointLight(arena.color,28,15,2);light.position.set(x,5,(minZ+maxZ)/2);world.add(light);}}
    this.raceModels=new Map();
    if(arena.race)raceTrackModel(arena.race,arena.color,world,undefined,{quality:this._quality(),surface:(mat,kind,rx,ry)=>this._mothSurface(mat,kind,rx,ry,arenaSeed)});
    this.buildNextGen(world,arena);
   this.addTraversal(world,arena,glow);
   // Chunked static-architecture batches (real WebGL only; the CPU renderer and
   // the test mock keep individual meshes for predictable depth ordering).
   this._batchArenaBlocks(world);
   // Unused family colors never reach the scene's normal disposal traversal.
    const usedMaterials=new Set();world.traverse(n=>{if(n.material)usedMaterials.add(n.material);});for(const mat of new Set(palette))if(!usedMaterials.has(mat))mat.dispose();   const skyPhaseName=skyPhase(arena),halo=HALO_MAPS.has(arena.id),sunDir=arena.id==='aether'?[-18,24,-12]:arena.id==='foundry'?[18,24,-12]:[18,24,10],quality=this._quality();this.scene.userData.sky={background:arena.background,phase:skyPhaseName,seed:arenaSeed,halo,sunDir,mood:biomeAmbience(arena).mood,weather:this.weatherState?this.weatherState.kind:'clear'};if(this.renderer?.isSoftware!==true){this.sky=addSky(world,{background:arena.background,radius:185,phase:skyPhaseName,seed:arenaSeed,starCount:Math.round((skyPhaseName==='night'?520:0)*quality.stars),halo,sunDir});this.mountains=addMountains(world,{background:arena.background,seed:arenaSeed,radius:150,count:Math.max(8,Math.round(26*quality.scatter)),base:-12,detail:quality.scatterDetail});if(arena.terrain&&arena.scatter!==false)this.scatterWind=addScatter(world,{terrain:arena.terrain,bounds,seed:arenaSeed,wind:true,density:quality.scatter,detail:quality.scatterDetail,biome:arena.biome})||[];const atmosphere=mothAtmosphereFor(arena.id);if(atmosphere)this._applyMothAtmosphere(atmosphere);}
    else this.scatterWind=[];
    this.ambientFx=null;this.ambientPool?.dispose?.();this.ambientPool=null;this.ambientConfig=ambientProfile(arena,skyPhaseName);this.ambientSeed=arenaSeed;this.ambientAnchors=smokeAnchors(bounds,arenaSeed,4);
    this.weatherFx=null;this.weatherPool?.dispose?.();this.weatherPool=null;this.initWeather(arena);
   if(this.renderer?.shadowMap)this.renderer.shadowMap.needsUpdate=true;
  }
  // Merge rigid floor tiles into one material batch. UVs, normals and the
  // receive-shadow flag are preserved; returns null when merging is unavailable.
  _mergeFloorTiles(tiles,material){
   if(typeof mergeGeometries!=='function'||!tiles?.length)return null;
   try{
    const unit=new T.BoxGeometry(1,1,1),geoms=[];
    for(const t of tiles){const g=unit.clone();g.scale(t.w,.5,t.d);g.translate(t.x,-.25,t.z);geoms.push(g);}
    unit.dispose();
    const merged=mergeGeometries(geoms,false);
    for(const g of geoms)g.dispose();
    if(!merged)return null;
    const mesh=new T.Mesh(merged,material);mesh.receiveShadow=true;mesh.userData.arenaFloor=true;mesh.userData.floorTiles=tiles.length;
    return mesh;
   }catch{return null;}
  }
  // Group static meshes by material and coarse spatial cell, so each merged batch
  // stays small enough for the frustum to cull. Pure: returns groups, merges nothing.
  _groupByMaterialChunk(meshes,chunkSize=24){
   const size=Math.max(4,Number(chunkSize)||24),groups=new Map();
   for(const mesh of meshes||[]){
    const mat=mesh.material,key=`${mat?.uuid||'none'}|${Math.floor((mesh.position.x||0)/size)},${Math.floor((mesh.position.z||0)/size)}`;
    let group=groups.get(key);if(!group){group={material:mat,meshes:[]};groups.set(key,group);}group.meshes.push(mesh);
   }
   return [...groups.values()];
  }
  // Batch visible static block meshes on real WebGL only. Each batch preserves the
  // block's authored transform and material; the authoritative collision boxes in
  // `arena.blocks` are untouched and a bounded per-batch block count is recorded.
  _batchArenaBlocks(world){
   if(this.renderer?.isWebGLRenderer!==true||typeof mergeGeometries!=='function'||!world)return 0;
   const candidates=world.children.filter(n=>n.isMesh&&Number.isInteger(n.userData.block)&&n.visible);
   let batches=0,merged=0;
   for(const group of this._groupByMaterialChunk(candidates,24)){
    if(group.meshes.length<2)continue;
    const geoms=[];
    for(const mesh of group.meshes){mesh.updateMatrix();const g=mesh.geometry.clone();g.applyMatrix4(mesh.matrix);geoms.push(g);}
    const geometry=mergeGeometries(geoms,false);
    for(const g of geoms)g.dispose();
    if(!geometry)continue;
    const batch=new T.Mesh(geometry,group.material);
    batch.castShadow=true;batch.receiveShadow=true;batch.userData.blockBatch=true;batch.userData.blocks=group.meshes.length;
    world.add(batch);
    for(const mesh of group.meshes)world.remove(mesh);
    batches++;merged+=group.meshes.length;
   }
   world.userData.blockBatches=batches;
   world.userData.blockBatchCount=merged;
   return batches;
  }
    addTraversal(world,arena,glow){const pads=[...traversalItems(arena,'trampolines'),...traversalItems(arena,'jumpPads'),...traversalItems(arena,'pads')],launchers=[...traversalItems(arena,'boostLaunchers'),...traversalItems(arena,'launchers')],links=arena.jumpLinks||[];const shared=this.renderResources??=new Set(),padGeo=new T.CylinderGeometry(.7,.7,.12,16),padMat=this._mothLutMaterial('entanglement-arcane',{base:{color:arena.color,metalness:.25,roughness:.25,emissive:arena.color},phase:.2,intensity:.35})??material(arena.color,.25,.25,true),launchGeo=new T.BoxGeometry(.8,.1,1.3),launchMat=material(arena.color,.25,.25,true);shared.add(padGeo).add(padMat).add(launchGeo).add(launchMat);for(const raw of pads){const p=pointOf(raw),y=p.y??0,m=new T.Mesh(padGeo,padMat);m.position.set(p.x,y+.06,p.z);m.userData.traversal='trampoline';world.add(m);ring(world,.78,.035,p.x,y+.13,p.z,padMat); }for(const raw of launchers){const p=pointOf(raw),y=p.y??0,m=new T.Mesh(launchGeo,launchMat),id=raw.id??raw.traversal??raw.traversalId??raw.traversalID,link=links.find(item=>(item.traversal??item.traversalId??item.traversalID)===id),from=link&&pointOf(link.source),to=link&&pointOf(link.target);m.position.set(p.x,y+.05,p.z);m.rotation.y=from&&to?Math.atan2(to.x-from.x,to.z-from.z):raw.rotation??raw.yaw??(Array.isArray(raw.dir)?Math.atan2(raw.dir[0],raw.dir[1]):0);m.userData.traversal='boost-launcher';world.add(m);m.userData.stripes=[-.25,.25].map(x=>box(m,.06,.04,.9,x,.08,0,glow));}for(const link of links){const from=pointOf(link.source),to=pointOf(link.target),mid=V((from.x+to.x)/2,Math.max(from.y??0,to.y??0)+4,(from.z+to.z)/2),geo=new T.BufferGeometry().setFromPoints([V(from.x,(from.y??0)+.14,from.z),mid,V(to.x,(to.y??0)+.14,to.z)]),arc=new T.Line(geo,glow);arc.userData.traversal='jump-link';world.add(arc);}const teleporters=traversalItems(arena,'teleporters');if(teleporters.length){const padGeo2=new T.CylinderGeometry(.9,.9,.16,20),padMat2=this._mothLutMaterial('entanglement-arcane',{base:{color:arena.color,metalness:.3,roughness:.25,emissive:arena.color},phase:.55,intensity:.6})??material(arena.color,.3,.25,true);shared.add(padGeo2).add(padMat2);for(const raw of teleporters){const p=pointOf(raw),y=p.y??0,m=new T.Mesh(padGeo2,padMat2);m.position.set(p.x,y+.08,p.z);m.userData.traversal='teleporter';world.add(m);ring(world,1,.04,p.x,y+.16,p.z,padMat2);ring(world,1.35,.03,p.x,y+.16,p.z,padMat2);}}const ziplines=traversalItems(arena,'ziplines');if(ziplines.length){const cableMat=material('#e7b55b',.55,.32,true),anchorMat=material('#c9d6dd',.85,.3);shared.add(cableMat).add(anchorMat);const groundAt=(x,z)=>arena.terrain?.height?.(x,z)??0;for(const raw of ziplines){const from=pointOf(raw.from??raw.a),to=pointOf(raw.to??raw.b),lift=Number(raw.lift)||0,sag=Math.max(0,Number(raw.sag)||0),ax=from.x,ay=(from.y??groundAt(ax,from.z))+lift,az=from.z,bx=to.x,by=(to.y??groundAt(bx,to.z))+lift,bz=to.z,cableY=y=>y+ZIP_CABLE_HANDLE,control=V((ax+bx)/2,cableY((ay+by)/2-2*sag),(az+bz)/2),curve=new T.QuadraticBezierCurve3(V(ax,cableY(ay),az),control,V(bx,cableY(by),bz)),cable=new T.Mesh(new T.TubeGeometry(curve,14,.07,5,false),cableMat);cable.userData.traversal='zipline';world.add(cable);for(const [x,y,z] of [[ax,cableY(ay),az],[bx,cableY(by),bz]]){const floor=groundAt(x,z),top=Math.max(y,floor+.6),h=top-floor,post=cylinder(world,.06,.09,h,x,floor+h/2,z,anchorMat,8);post.userData.traversal='zipline';ring(world,.2,.028,x,y,z,cableMat,0);}}}}
 // Smooth geometry for next-gen maps: roofs, arches, columns, tunnels, cavern
 // domes and organic props replace the raw collision boxes (which are hidden).
 buildNextGen(world,arena){
  const structures=arena.structures||[],props=arena.props||[];
  if(!structures.length&&!props.length)return;
  const shared=this.renderResources??=new Set(),cache=new Map();
  const geo=(key,make)=>{let g=cache.get(key);if(!g){g=make();cache.set(key,g);shared.add(g);}return g;};
  const surfaceSeed=arenaSeedOf(arena),wallMat=this._mothSurface(material(arena.color,.35,.5,false),'rough_stucco',1,1,surfaceSeed),stone=this._mothSurface(material('#8a8378',.05,.92),'rock',2,2,surfaceSeed),wood=material('#6b4a2f',.1,.85),leaf=this._mothSurface(material('#4f8f4a',.15,.85),'alien_chitin',2,2,surfaceSeed),metal=this._mothSurface(material('#6b737a',.65,.45),'metal',1,1,surfaceSeed),barrel=this._mothSurface(material('#b0703f',.35,.6),'brushed_metal',2,1,surfaceSeed),dark=material('#20262b',.5,.55),glass=material('#8fd8ff',.2,.15,true),tunnelMat=this._mothSurface(material('#7c756a',.04,.94),'rock',1,1,surfaceSeed),caveMat=this._mothSurface(material('#6a6258',.03,.96),'rock',2,2,surfaceSeed);tunnelMat.side=T.DoubleSide;caveMat.side=T.DoubleSide;
  const hash3=(x,y,z,s)=>{let h=Math.imul(Math.round(x*13)+1,374761393)^Math.imul(Math.round(y*13)+7,668265263)^Math.imul(Math.round(z*13)+3,s|0);h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967295;};
  const mesh=(g,m,x,y,z,rx=0,ry=0,rz=0)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.castShadow=true;o.receiveShadow=true;world.add(o);return o;};
  for(const s of structures){
   if(s.type==='building'){
    const sw=s.w,sd=s.d; // Roof follows the same normalized local parent frame.
    if(s.roof==='gable'){const rh=Math.min(3.2,Math.max(1.6,Math.min(sw,sd)*.36)),g=geo(`gable|${sw.toFixed(1)}|${sd.toFixed(1)}|${rh.toFixed(1)}`,()=>{const shape=new T.Shape();shape.moveTo(-sw/2,0);shape.lineTo(sw/2,0);shape.lineTo(0,rh);shape.closePath();const e=new T.ExtrudeGeometry(shape,{depth:sd,bevelEnabled:false});e.translate(0,0,-sd/2);return e;});mesh(g,wallMat,s.x,s.y+s.h,s.z,0,-s.rot,0);}
    else{const g=geo(`flat|${sw.toFixed(1)}|${sd.toFixed(1)}`,()=>new T.BoxGeometry(sw+.5,.42,sd+.5));mesh(g,dark,s.x,s.y+s.h+.2,s.z,0,-s.rot,0);}
   }else if(s.type==='windows'||s.type==='facade-detail'){
    if(s.frame){
     const g=geo('facade-unit',()=>new T.BoxGeometry(1,1,1));
     for(const p of facadeDetails(s,s.detail)){const m=mesh(g,s.type==='windows'?glass:metal,p.x,p.y,p.z,0,p.rot,0);m.scale.set(p.w,p.h,p.d);m.userData.facadeDetail=true;}
     continue;
    }
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
    const r=s.radius??3;
    for(const raw of tunnelRenderPaths(s,structures)){
    const path=raw.map(([x,y,z])=>({x,y,z}));
    const R=Math.max(.5,r*.95),ring=8,verts=[],uvs=[],idx=[];
    const tangent=i=>{const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)];const tx=b.x-a.x,tz=b.z-a.z,l=Math.hypot(tx,tz)||1;return {x:tx/l,z:tz/l};};
    // World-unit UVs (one tile per ~4.5m along and around) so the rock bake can
    // wrap the shell; the tube has no authored UVs of its own.
    let run=0;
    for(let i=0;i<path.length;i++){const p=path[i];if(i>0){const q=path[i-1];run+=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z);}const t=tangent(i),sx=-t.z,sz=t.x;for(let j=0;j<=ring;j++){const a=Math.PI*j/ring;verts.push(p.x+sx*R*Math.cos(a),p.y+R*Math.sin(a),p.z+sz*R*Math.cos(a));uvs.push(run*.22,(j/ring)*Math.PI*2*R*.22);}}
    for(let i=0;i<path.length-1;i++)for(let j=0;j<ring;j++){const a=i*(ring+1)+j,b=a+1,c=a+ring+1,d=c+1;idx.push(a,c,d,a,d,b);}
    const key=`tun|${r}|${JSON.stringify(raw)}`;
    const g=path.length>1?geo(key,()=>{const bg=new T.BufferGeometry();bg.setAttribute('position',new T.Float32BufferAttribute(verts,3));bg.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));bg.setIndex(idx);bg.computeVertexNormals();return bg;}):null;
    if(g){const m=mesh(g,tunnelMat,0,0,0);m.castShadow=false;m.userData.tunnelShell=true;}
    }
   }else if(s.type==='cavern'){
    const shell=cavernShell(s.radius??12,s.height??8,undefined,s.openSegments),base=s.y??0,dome=geo(`cavdome|${shell.radius}`,()=>new T.SphereGeometry(shell.radius,28,12,0,Math.PI*2,0,Math.PI/2));
    for(const arc of shell.renderArcs){const key=`cavarc|${shell.radius}|${arc.thetaStart.toFixed(3)}|${arc.thetaLength.toFixed(3)}`,wg=geo(key,()=>new T.CylinderGeometry(shell.radius,shell.radius,1,28,1,true,arc.thetaStart,arc.thetaLength));const m=mesh(wg,caveMat,s.x,base+shell.wallHeight/2,s.z);m.scale.set(1,shell.wallHeight,1);}
    const roof=mesh(dome,caveMat,s.x,base+shell.wallHeight,s.z);roof.scale.set(1,shell.domeHeight/shell.radius,1);
   }else if(s.type==='bridge'){
    const q=((Math.round((s.rot||0)/(Math.PI/2))%4)+4)%4,along=q%2?'z':'x',len=q%2?(s.d??s.w):(s.w??s.d),wid=q%2?(s.w??s.d):(s.d??s.w),rail=gx=>geo(gx,()=>(gx==='rail-x'?new T.BoxGeometry(1,.12,.12):new T.BoxGeometry(.12,.12,1)));
    for(const side of[-1,1]){const m=mesh(along==='x'?rail('rail-x'):rail('rail-z'),metal,s.x,s.y+(s.thickness??.5)+.45,s.z+(along==='x'?side*(wid/2-.1):0));m.rotation.y=(s.rot||0);m.scale.set(along==='x'?len:1,1,along==='x'?1:len);}
   }
  }
  if(props.length){
   // Batch the repeated organic props into instanced meshes: one draw call per
   // prop family instead of one per rock/tree/crate. WebGL buys smoother shells;
   // the software renderer keeps the low-poly segments and shaded vertices.
   const software=this.renderer?.isSoftware===true,lowDetail=software||this._quality().tier===0;
   const groups={rock:[],tree:[],crate:[],barrel:[],lavaCrack:[],iceSpike:[]},ruins=[];
   for(const p of props){if(groups[p.type])groups[p.type].push(p);else ruins.push(p);}
   const instance=(geometry,mat,list,place)=>{if(!list.length)return null;const inst=new T.InstancedMesh(geometry,mat,list.length);inst.castShadow=true;inst.receiveShadow=true;const m=new T.Object3D();list.forEach((p,i)=>{place(p,m);m.updateMatrix();inst.setMatrixAt(i,m.matrix);});inst.instanceMatrix.needsUpdate=true;world.add(inst);return inst;};
   instance(geo('prop-rock',()=>{const g0=new T.IcosahedronGeometry(1,lowDetail?1:2),pos=g0.attributes.position;for(let i=0;i<pos.count;i++){const nx=pos.getX(i),ny=pos.getY(i),nz=pos.getZ(i),n=.72+.55*hash3(nx,ny,nz,7);pos.setXYZ(i,nx*n,ny*n*.82,nz*n);}g0.computeVertexNormals();paintGeometry(g0,7,.22);return g0;}),stone,groups.rock,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+s*.42,p.z);m.rotation.set(0,(p.seed??0)*.7,0);m.scale.setScalar(s);});
   instance(geo('prop-trunk',()=>paintGeometry(new T.CylinderGeometry(.11,.17,1.7,lowDetail?8:10),11,.18)),wood,groups.tree,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+.85*s,p.z);m.rotation.set(0,(p.seed??0)*.5,0);m.scale.setScalar(s);});
   instance(geo('prop-canopy',()=>paintGeometry(new T.ConeGeometry(1.1,2.3,lowDetail?10:14),13,.18)),leaf,groups.tree,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+2.15*s,p.z);m.rotation.set(0,(p.seed??0)*.5,0);m.scale.setScalar(s);});
   // Crates and barrels are destructible: keep their instanced meshes so a
   // shattered prop can be hidden by zeroing its instance matrix.
   const crateMesh=instance(geo('prop-crate',()=>paintGeometry(new T.BoxGeometry(1.2,1.2,1.2),17,.14)),wood,groups.crate,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+.6*s,p.z);m.rotation.set(0,(p.seed??0)*.4,0);m.scale.setScalar(s);});
   const barrelMesh=instance(geo('prop-barrel',()=>paintGeometry(new T.CylinderGeometry(.5,.5,1.15,lowDetail?12:16),19,.16)),barrel,groups.barrel,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+.58*s,p.z);m.scale.setScalar(s);});
   // Biome hazard dressing: glowing lava cracks and translucent ice spikes.
   const lavaMat=material('#ff6a2a',.2,.7,true),iceMat=this._mothSurface(material('#bcd8e8',.1,.2,false),'ice',2,2,surfaceSeed);iceMat.transparent=true;iceMat.opacity=.82;
   instance(geo('prop-lava',()=>paintGeometry(new T.BoxGeometry(4.2,.12,.7),23,.1)),lavaMat,groups.lavaCrack,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+.07,p.z);m.rotation.set(0,p.rot??0,0);m.scale.set(s,1,s);});
   instance(geo('prop-ice',()=>paintGeometry(new T.ConeGeometry(.55,2.2,lowDetail?6:8),29,.14)),iceMat,groups.iceSpike,(p,m)=>{const s=p.scale??1;m.position.set(p.x,p.y+1.1*s,p.z);m.rotation.set(0,(p.seed??0)*.9,0);m.scale.setScalar(s);});
   this._registerBreakables(props,{crate:crateMesh,barrel:barrelMesh});
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
 // Destructible props are presentation-only: the collision block stays in the
 // map, so breaking a crate never changes authoritative movement. The entry
 // table maps each authored prop to its instance slot in the batched mesh.
 _registerBreakables(props,meshes){
  const world=this.worldGroup;if(!world)return;
  const entries=[],counters={crate:0,barrel:0};
  for(let i=0;i<props.length;i++){
   const p=props[i];if(!isBreakable(p.type))continue;
   const mesh=meshes[p.type];if(!mesh)continue;
   entries.push({prop:p,id:propId(p,i),mesh,index:counters[p.type]++});
  }
  world.userData.breakables={entries,state:new Map(),hidden:new Set()};
 }
 // Apply an area hit to nearby destructible props. Deterministic: the same
 // position, radius and serial break the same props and emit the same debris.
 // Skipped entirely on the CPU renderer and under reduced motion so the software
 // path never pays for debris it cannot show.
 breakPropsAt(pos,{radius=4,amount=40,serial=0,reduced=false}={}){
  if(this.renderer?.isSoftware===true||reduced||!pos)return 0;
  const data=this.worldGroup?.userData?.breakables;if(!data)return 0;
  const r=Math.max(.1,Number(radius)||4),damage=Number(amount)||0;if(damage<=0)return 0;
  const zero=new T.Matrix4().makeScale(0,0,0);let broken=0;
  for(const entry of data.entries){
   if(data.hidden.has(entry.id))continue;
   const p=entry.prop;if(Math.hypot((p.x||0)-(pos.x||0),(p.z||0)-(pos.z||0))>r)continue;
   const result=applyPropDamage(data.state,entry.id,p.type,damage);
   if(!result||!result.broken||result.wasBroken)continue;
   data.hidden.add(entry.id);
   entry.mesh.setMatrixAt(entry.index,zero);entry.mesh.instanceMatrix.needsUpdate=true;
   const plan=propBreakPlan({...p,id:entry.id},{origin:pos,serial,reduced});
   if(plan){this.debrisPool??=new DebrisPool(this.scene,this._quality().deaths);this.debrisPool.spawn(plan);}
   broken++;
  }
  return broken;
 }
 _updateDebris(delta){if(this.renderer?.isSoftware===true||!this.debrisPool)return 0;this.debrisPool.update(delta);return this.debrisPool.slots.filter(s=>s.active).length;}
 makeMenu(){const scene=new T.Scene();scene.background=new T.Color('#080f13');scene.fog=new T.FogExp2('#080f13',.055);const camera=new T.PerspectiveCamera(38,1,.1,80);camera.position.set(5,3.3,10);camera.lookAt(0,1.4,0);scene.add(new T.HemisphereLight('#bdedee','#233139',2.8));const key=new T.DirectionalLight('#e4fff3',4);key.position.set(-4,6,5);scene.add(key);const rim=new T.PointLight('#52e5cf',80,15);rim.position.set(3,3,-3);scene.add(rim);
 const dark=material('#152128',.8,.4),glow=material('#67e7d3',.4,.2,true),ringGlow=this._mothLutMaterial('entanglement',{base:{color:'#67e7d3',metalness:.4,roughness:.2,emissive:'#67e7d3'},phase:.1,intensity:.45})||glow;if(ringGlow!==glow)this.sharedResources.add(ringGlow);box(scene,50,.3,50,0,-.35,0,dark);const grid=new T.GridHelper(40,40,'#284443','#192c31');grid.position.y=-.19;scene.add(grid);cylinder(scene,1.55,1.8,.3,0,-.02,0,dark,48);ring(scene,1.57,.018,0,.15,0,ringGlow);ring(scene,2.05,.014,0,-.16,0,ringGlow);ring(scene,2.2,.01,0,-.16,0,ringGlow);
 for(let i=-4;i<=4;i++){box(scene,.25,9,.5,i*3,4,-6,dark);box(scene,.045,6,.04,i*3+.18,4,-5.72,glow);}
  const model=robotModel('chatgpt',undefined,this.renderer?.isSoftware===true);model.scale.setScalar(2.15);model.position.y=.17;model.rotation.y=.25;scene.add(model);return {scene,camera,model,id:'chatgpt'};}
  setCharacter(id){if(id===this.menu.id)return;this.disposeObject(this.menu.model);this.menu.scene.remove(this.menu.model);this.menu.model=robotModel(id,undefined,this.renderer?.isSoftware===true);this.menu.model.scale.setScalar(2.15);this.menu.model.position.y=.17;this.menu.scene.add(this.menu.model);this.menu.id=id;}
      setMatch(match){this.clearFreeMotion();this.characterLifecycle?.clear();const arena=match.arena||MAPS.find(a=>a.id===match.mapId)||MAPS[0];this.clearObjectiveMarkers();if(this.payloadModel){this.scene.remove(this.payloadModel);this.disposeObject(this.payloadModel);this.payloadModel=null;}for(const m of [...this.actorModels.values(),...this.pickupModels,...(this.flagModels||new Map()).values()]){this.scene.remove(m);this.disposeObject(m);}this.flagModels=new Map();if(this.mapId!==arena.id)this.buildArena(arena);const assets=this.modelAssets??=new ModelAssets();this.actorModels=new Map((match.actors||[]).map(a=>{const m=robotModel(a.character,assets,this.renderer?.isSoftware===true);this.scene.add(m);return [a.id,m];}));this.pickupModels=(match.pickups||[]).map(p=>{const g=new T.Group(),colors={health:'#77efba',armor:'#6dbfff',rocket:'#ffb164',rail:'#bf9cff',scatter:'#ffde87',plasma:'#72cfff',grenade:'#ff806b',shock:'#8ce8ff',flak:'#ffd166',marksman:'#ffd27a',smg:'#8affc1',haste:'#72f1b8',overcharge:'#ff8f70',overshield:'#75baff',recon:'#7fe7ff',cloak:'#c8b6ff'},pickupColor=colors[p.kind]||'#8ad9d3',mat=this._mothLutMaterial(this._mothLutTheme(arena),{base:{color:pickupColor,metalness:.4,roughness:.3,emissive:pickupColor},phase:.15,intensity:.4})??material(pickupColor,.4,.3,true);if(p.kind==='health'){box(g,.6,.19,.19,0,.65,0,mat);box(g,.19,.6,.19,0,.65,0,mat);}else if(p.kind==='armor'){const m=new T.Mesh(geometry(assets,'pickup-armor-octa',()=>new T.OctahedronGeometry(.4)),mat);m.position.y=.7;g.add(m);}else if(['haste','overcharge','overshield'].includes(p.kind)){const m=new T.Mesh(geometry(assets,'pickup-power-ico',()=>new T.IcosahedronGeometry(.36,1)),mat);m.position.y=.7;g.add(m);ring(g,.55,.022,0,.07,0,mat);}else{const w=simpleWeaponModel(pickupWeapon(p.kind),assets);w.position.y=.75;w.scale.setScalar(.7);g.add(w);}if(!['haste','overcharge','overshield'].includes(p.kind))ring(g,.55,.022,0,.07,0,mat);g.position.set(p.x||0,p.y||0,p.z||0);this.scene.add(g);return g;});this._trackAssets(assets);this.syncVehicles(match);this.updateFlags(match,arena);this.updateObjectives(match,arena);this.effectPool?.clear();this.telegraphPool?.clear();for(const m of this.zipCarriages?.values()||[]){this.scene.remove(m);this.disposeObject(m);}this.zipCarriages?.clear();this._fovPulse=0;this.projectilePool?.clear();this._clearMothSprites();this.railPool?.clear();this.deathContext?.clear();this.deathPool?.clear();this.decalPool?.clear();this.ambientFx?.reset();this.debrisPool?.clear();this.hitFlinch?.clear();this.hitPool?.clear();this._killcam=null;this.feedback?.reset();this.cameraShake?.reset();this.lowHealth=false;this.flashUntil=0;this.lastEvent=match.serial||0;this.currentWeapon=-1;this._adsTransition=0;this._adsController?.reset(this.display?.fov??82);this._nearActionAt=undefined;this._nearAction=0;this._cocsPresentation=null;this.resetPresentation();
  // Per-mode music theme. The audio object retunes its running drone in place.
  const mode=match.config?.mode??match.mode;if(mode)this.viewAudio?.setModeTheme?.(mode);this._modeTheme=mode??this._modeTheme;}
      syncActors(match){const actors=match?.actors||[];for(const actor of actors)if(!this.actorModels.has(actor.id)){const model=robotModel(actor.character,this.modelAssets??=new ModelAssets(),this.renderer?.isSoftware===true);applyActorTeam(model,actor.team,this.display?.teamPalette);this.scene.add(model);this.actorModels.set(actor.id,model);}const live=new Set(actors.map(actor=>actor.id));for(const [id,model] of this.actorModels)if(!live.has(id)){this.characterLifecycle?.release(model);this.scene.remove(model);this.disposeObject(model);this.actorModels.delete(id);}}
      styleActor(model,actor,palette){if(this.characterLifecycle?.ownsTransform(model))return;applyActorTeam(model,actor.team,palette);const profile=actor?.npcProfile;if(!profile)return;const data=model.userData||{};if(data.base?.material?.color)data.base.material.color.set(profile.color);if(data.armor?.color)data.armor.color.set(profile.accent||profile.color);model.scale.setScalar(profile.scale??1);}
      updateWaypoint(match,arena){const waypoint=match?.waypoint;if(!waypoint){if(this.waypointModel){this.scene.remove(this.waypointModel);this.disposeObject(this.waypointModel);this.waypointModel=null;this.waypointId=null;}return;}if(!this.waypointModel||this.waypointId!==waypoint.id){if(this.waypointModel){this.scene.remove(this.waypointModel);this.disposeObject(this.waypointModel);}this.waypointId=waypoint.id;this.waypointModel=this.createObjectiveModel({id:'waypoint',x:waypoint.x,y:waypoint.y??0,z:waypoint.z,radius:waypoint.radius??4,label:waypoint.label},arena);this.scene.add(this.waypointModel);}this.waypointModel.position.set(waypoint.x,waypoint.y??0,waypoint.z);}
   createFlagModel(team,arena){const resources=this.renderResources??=new Set(),color=this.objectiveColor(team,arena);const assets=this.flagAssets??={},poleGeo=assets.pole??=new T.CylinderGeometry(.035,.05,1.8,8),bannerGeo=assets.banner??=new T.BoxGeometry(.52,.32,.035),baseGeo=assets.base??=new T.CylinderGeometry(.34,.42,.08,16),mat=this._mothLutMaterial('entanglement',{base:{color,metalness:.35,roughness:.3,emissive:color},phase:.3,intensity:.5})??material(color,.35,.3,true);resources.add(poleGeo);resources.add(bannerGeo);resources.add(baseGeo);const g=new T.Group();const pole=new T.Mesh(poleGeo,mat);pole.position.y=.9;g.add(pole);const banner=new T.Mesh(bannerGeo,mat);banner.position.set(.24,1.55,0);g.add(banner);for(const z of [-.025,.025]){const mark=teamMark();mark.position.set(.24,1.55,z);updateTeamMark(mark,team);g.add(mark);}const base=new T.Mesh(baseGeo,mat);base.position.y=.04;g.add(base);g.userData={team,teamLabel:teamPresentation(team,this.display?.teamPalette)?.label??null,flag:true,banner,material:mat};return g;}
     updateFlags(match,arena=MAPS[0]){this.updateVehicleModels(match);const input=match?.flags;if(!input){for(const g of this.flagModels?.values()||[])g.visible=false;return;}const flags=Array.isArray(input)?input:Object.entries(input).map(([team,flag])=>({...flag,team:flag?.team??team}));const active=new Set();for(const flag of flags.slice(0,8)){if(!flag)continue;const team=flag.team??flag.teamId??flag.id??0,key=String(team);let g=this.flagModels.get(key);if(!g){g=this.createFlagModel(team,arena);this.flagModels.set(key,g);this.scene.add(g);}active.add(key);const carrier=flag.carrier??flag.carrierId??flag.carriedBy;g.visible=carrier==null&&flag.state!=='carried'&&flag.status!=='carried';const p=pointOf(flag);g.position.set(p.x||0,p.y||0,p.z||0);g.rotation.y=flag.yaw??0;const dropped=flag.dropped===true||flag.state==='dropped'||flag.status==='dropped';const pulse=dropped&&!this.reduced();g.scale.setScalar(pulse?1+Math.sin((match.time||0)*7)*.08:1);g.userData.banner.material.opacity=dropped?.75:1;g.userData.banner.material.transparent=true;const flagColor=this.objectiveColor(team,arena),flagMaterial=g.userData.material;if(flagMaterial){flagMaterial.color.set(flagColor);flagMaterial.emissive?.set(flagColor);g.userData.banner.material.color.set(flagColor);}}for(const [key,g] of this.flagModels)if(!active.has(key))g.visible=false;}
     objectiveColor(team,arena,neutral=NEUTRAL){return teamPresentation(team,this.display?.teamPalette)?.color??neutral;}
       createObjectiveModel(zone,arena){const radius=Math.max(.8,Number(zone.radius)||3.5),progressValue=Math.max(0,Math.min(100,Number(zone.progress)||0)),software=this.renderer?.isSoftware===true,g=new T.Group(),tint=this.objectiveColor(zone.owner,arena),lutName=this._mothLutTheme(arena),baseMat=material(tint,.25,.3,true),areaMat=material(tint,.15,.8,true),progressMat=this._mothLutMaterial(lutName,{base:{color:'#ffd166',metalness:.2,roughness:.25,emissive:'#ffd166'},phase:.45,intensity:.7})??material('#ffd166',.2,.25,true),beaconMat=this._mothLutMaterial(lutName,{base:{color:tint,metalness:.25,roughness:.3,emissive:tint},phase:.15,intensity:.6})??material(tint,.25,.3,true),beacon=cylinder(g,.09,.16,2.4,0,1.2,0,beaconMat,10),area=new T.Mesh(new T.CylinderGeometry(radius,radius,.035,32),areaMat),base=ring(g,radius,.11,0,.05,0,baseMat),progress=new T.Mesh(software?new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progressValue/100):new T.RingGeometry(radius-.2,radius+.2,32),progressMat),emblem=new T.Mesh(new T.CylinderGeometry(.34,.34,.08,8),progressMat);for(const mat of [baseMat,areaMat,progressMat])mat.depthWrite=false;beaconMat.depthTest=false;beaconMat.depthWrite=false;area.position.y=.018;area.renderOrder=1;base.renderOrder=1;progress.rotation.x=-Math.PI/2;progress.position.y=.07;progress.renderOrder=1;emblem.position.y=.13;emblem.renderOrder=1;beacon.renderOrder=100;if(!software)progress.geometry.setDrawRange(0,0);g.add(area,progress,emblem);g.userData={objective:true,area,base,beacon,progress,emblem,areaMat,baseMat,progressMat,beaconMat,radius,identifier:String(zone.id??'zone')};g.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});return g;}
     clearObjectiveMarkers(){for(const g of this.objectiveModels?.values()||[]){this.worldGroup?.remove(g);this.disposeObject(g);}this.objectiveModels?.clear();}
     // --- Moth-baked sprite effects ----------------------------------------
     // One pooled sheet player per baked effect, created lazily on the WebGL
     // renderer. Frames are shared caches owned by textures.mjs, so players are
     // released with the arena/view and never dispose a frame a sibling uses.
     _mothSprite(name,{slots=4,opacity=.8}={}){
      if(this.renderer?.isSoftware===true)return null;
      const cache=this._mothSpriteCache??=new Map();
      if(cache.has(name))return cache.get(name);
      const sheet=mothEffectTextures(name);
      const player=sheet?.textures?.length?new MothSpritePlayer({name,frames:sheet.textures,fps:sheet.fps,slots,opacity}):null;
      player?.attach(this.scene);
      cache.set(name,player);
      return player;
     }
     _spawnMothSprite(name,position,options){const player=this._mothSprite(name,options);return player?.spawn(position,options)??null;}
     // Prefer a dedicated baked sequence, but fall back to the caller's current
     // cue when the texture is missing (an older bake or a partial registry), so
     // wiring a new effect never removes the existing read.
     _mothFx(name,fallback,position,options){const player=this._mothSprite(name,options);if(player)return player.spawn(position,options)??null;return fallback?this._spawnMothSprite(fallback,position,options):null;}
     _clearMothSprites(){for(const player of this._mothSpriteCache?.values?.()||[])player?.clear?.();}
     _updateMothSprites(dt,camera=this.camera){const cache=this._mothSpriteCache;if(!cache?.size)return 0;const reduced=this.reduced?.()===true;let active=0;for(const player of cache.values()){player?.update(dt,{reduced,camera});active+=player?.active??0;}return active;}
     _disposeMothSprites(){const cache=this._mothSpriteCache;if(!cache)return 0;for(const player of cache.values())player?.dispose?.();const count=cache.size;cache.clear();return count;}
     // --- Moth entanglement LUT materials ----------------------------------
     // The baked reflectance LUTs drive an iridescent fresnel film on a standard
     // material. Materials are created per landmark (and disposed with it) while
     // the LUT texture itself is a shared cache owned by textures.mjs; volcanic
     // maps ride the ember LUT, everything else the arcane one. The plain
     // `entanglement` LUT stays on flags/pickups so the original bake is in play.
     _mothLutTheme(arena){const id=arena?.id;return ['ember-caldera','slagworks','forge','ashen-rift'].includes(id)?'entanglement-ember':'entanglement-arcane';}
     _mothLutMaterial(name,{base={},phase=.35,intensity=.9,track=false}={}){
      if(this.renderer?.isWebGLRenderer!==true)return null;
      const lut=mothMaterialLutTexture(name);
      if(!lut)return null;
      const mat=createMothLutMaterial({lut,base,phase,intensity});
      if(track)(this.renderResources??=new Set()).add(mat);
      return mat;
     }
     // Apply the baked Moth surface maps to a material. The macro anti-tiling
     // enhancer runs on WebGL only and is a no-op for grid kinds; the CPU
     // renderer keeps its flat authored materials. Shared by the arena build,
     // next-gen props/structures and race/soccer presentation.
     _mothSurface(mat,kind,rx,ry,seed=1){
      if(!mat||this.renderer?.isSoftware===true||typeof document==='undefined')return mat;
      const maps=surfaceTextures(kind,{seed,repeat:[rx,ry]});
      if(maps){mat.map=maps.map;mat.roughnessMap=maps.roughnessMap;mat.normalMap=maps.normalMap;mat.normalScale=new T.Vector2(.6,.6);}
      if(maps&&this.renderer?.isWebGLRenderer===true)enhanceMothMaterial(mat,{kind,macro:mothMacroTexture()});
      return mat;
     }
     // Advance the Moth arena's animated rift: cycle the baked effect frames and
     // slowly tumble the iridescent landmark.
     updateMothRift(time){const sheet=this._mothRiftSheet,t=Number.isFinite(time)?time:0;if(sheet){const i=Math.floor((t*sheet.fps)%sheet.frames.length);if(i!==sheet.index){sheet.index=i;sheet.mat.map=sheet.frames[i];sheet.mat.needsUpdate=true;}if(sheet.mesh)sheet.mesh.rotation.z=t*.08;}if(this._mothRift){this._mothRift.rotation.y=t*.35;this._mothRift.rotation.x=Math.sin(t*.2)*.25;}}
     createPayloadModel(team,arena){
      const g=new T.Group(),color=this.objectiveColor(team,arena),skin=material('#f3b9c6',.15,.72),snoutMat=material('#e79aad',.15,.73),hoof=material('#2a2228',.3,.72),eyeMat=material('#171018',.2,.5),accent=material(color,.4,.3,true),glow=this._mothLutMaterial(this._mothLutTheme(arena),{base:{color,metalness:.35,roughness:.25,emissive:color},phase:.6,intensity:.75})??material(color,.35,.25,true);
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
      if(payload.contested&&!g.userData.contested&&!reduced)this._spawnMothSprite('arc-burst',{x:p.x||0,y:(p.y||0)+1.35,z:p.z||0},{size:3,opacity:.6,life:.5,grow:.5,slots:3});
      g.userData.contested=payload.contested===true;
      for(const part of g.userData.accentMaterials||[]){part.color.set(color);part.emissive?.set(color);}
      const beacon=g.userData.beacon,halo=g.userData.halo;
      if(beacon)beacon.material.emissiveIntensity=reduced?1:1+.6*Math.sin(t*4);
      if(halo)halo.scale.setScalar(reduced?1:1+.08*Math.sin(t*4));
     }
      // LATTICE STRIKE (`cocs`) world markers. A node is an objective area with
      // its archetype emblem (front cone / economy cube / relay octahedron /
      // array icosahedron / HQ hex pillar), tinted by owner and labelled in
      // world. Not-live capturable nodes dim; live nodes and anchors keep the
      // always-visible beacon. Follows the createObjectiveModel/disposeObject
      // lifecycle so nothing leaks on mode change or dispose.
      cocsNodes(match){const input=match?.objectives??match?.objectiveState;return match?.cocs?.nodes??input?.cocs?.nodes??input?.nodes??[];}
      // V0b traversal markers: id-keyed devices (live/cut/locked), depots
      // (owner/contest tinted) and arrival telegraphs. Presentation only,
      // reusing the objective-marker lifecycle; the order-strip readout is
      // derived in `cocs-orders.mjs`.
      cocsTraversal(match){const input=match?.objectives??match?.objectiveState;const source=match?.cocs?.traversal??input?.traversal??input?.cocs?.traversal;if(!source)return {devices:[],depots:[],arrivals:[]};const list=value=>Array.isArray(value)?value:Object.keys(value||{}).map(id=>({id,...value[id]}));const arrivals=(Array.isArray(source.arrivals)?source.arrivals:[]).map(entry=>({...entry,id:entry?.id??`arrival-${entry?.actor}`}));return {devices:list(source.devices),depots:list(source.depots),arrivals};}
      objectiveMarkZones(match){const input=match?.objectives??match?.objectiveState;return input?.kind==='cocs'?(match?.cocs?.nodes??input?.nodes??[]):(input?.zones||[]);}
      styleCocsModel(g,node){
       const archetype=String(node?.archetype??'front');
       if(g.userData.cocsArchetype!==archetype){
        const make={front:()=>new T.ConeGeometry(.4,.7,4),economy:()=>new T.BoxGeometry(.5,.5,.5),relay:()=>new T.OctahedronGeometry(.44),array:()=>new T.IcosahedronGeometry(.46,0),hq:()=>new T.CylinderGeometry(.52,.52,.44,6)}[archetype]??null;
        if(make&&g.userData.emblem){g.userData.emblem.geometry.dispose();g.userData.emblem.geometry=make();}
        g.userData.cocsArchetype=archetype;
       }
       if(!g.userData.cocsLabel&&typeof document!=='undefined'&&typeof document.createElement==='function'){
        const label=textLabel(g,COCS_NODE_LABELS[archetype]??'NODE',0,2.6,0,.85,'#eafff5');
        label.userData.objective=true;label.userData.noCameraOcclusion=true;g.userData.cocsLabel=label;
       }
      }
      // V0b SPOT marks. A `SCAN` order marks every living enemy inside the scan
      // radius for `spotSeconds`; this is presentation only (the +15% team
      // damage lives in `Match.damage`). A spotted enemy gets an always-on-
      // read ring + chevron above the head for exactly the remaining window,
      // aged against the sim tick so the mark expires on the fixed clock.
      cocsSpots(match){
       const input=match?.objectives??match?.objectiveState;
       const source=match?.cocs?.spots??input?.cocs?.spots??input?.spots;
       if(Array.isArray(source))return source;
       if(source&&typeof source==='object')return Object.keys(source).map(id=>({id:Number(id),...source[id]}));
       return [];
      }
      cocsTick(match){const input=match?.objectives??match?.objectiveState;const tick=Number(match?.cocs?.tick??input?.cocs?.tick??input?.tick);return Number.isFinite(tick)?tick:null;}
      ensureSpotMark(model){
       if(!model?.userData)return null;
       if(model.userData.spotMark)return model.userData.spotMark;
       const group=new T.Group();group.name='cocs-spot';
       const mat=new T.MeshBasicMaterial({color:'#ffd166',transparent:true,opacity:.95,depthTest:false,depthWrite:false});
       const ring=new T.Mesh(new T.TorusGeometry(.42,.045,6,28),mat);ring.rotation.x=Math.PI/2;ring.position.y=1.35;group.add(ring);
       const chevron=new T.Mesh(new T.ConeGeometry(.16,.3,4),mat);chevron.rotation.x=Math.PI;chevron.position.y=1.72;group.add(chevron);
       group.traverse(node=>{node.userData.objective=true;node.userData.noCameraOcclusion=true;node.renderOrder=90;});
       group.visible=false;model.add(group);model.userData.spotMark=group;return group;
      }
      updateSpots(match){
       const spots=this.cocsSpots(match),tick=this.cocsTick(match),actors=match?.actors||[];
       const local=actors.find(actor=>actor&&actor.id===this.playerId)||null;
       const team=local&&(local.team===0||local.team===1)?local.team:null;
       const byId=new Map(actors.filter(actor=>actor&&actor.id!==undefined).map(actor=>[actor.id,actor]));
       const marked=new Set();
       if(team!==null&&tick!==null){
        for(const spot of spots){
         if(!spot||spot.team!==team)continue;
         if(!(Number(spot.until)>=tick))continue;
         if(spot.id===undefined||spot.id===null)continue;
         const target=byId.get(Number(spot.id));
         if(!target||!(Number(target.health)>0))continue;
         marked.add(Number(spot.id));
        }
       }
       this.actorModels??=new Map();
       for(const [id,model] of this.actorModels){
        const mark=model?.userData?.spotMark;
        if(mark)mark.visible=marked.has(id);
       }
       for(const id of marked){
        const model=this.actorModels.get(id);
        if(model)this.ensureSpotMark(model).visible=true;
       }
      }
      updateCocsObjectives(match,arena=MAPS[0]){
       const nodes=this.cocsNodes(match);
       this.objectiveModels??=new Map();
       const active=new Set(),reduced=this.reduced(),software=this.renderer?.isSoftware===true,time=Number(match?.time)||0;
       for(const node of nodes){
        if(!node||node.id===undefined||node.id===null)continue;
        const key=String(node.id),archetype=String(node.archetype??'front'),live=node.live===true,contested=node.contested===true,anchor=archetype==='hq'||archetype==='array';
        const owned=node.owner===0||node.owner===1,owner=owned?node.owner:null;
        const p0=Math.max(0,Math.min(1,Number(node.progress?.[0])||0)),p1=Math.max(0,Math.min(1,Number(node.progress?.[1])||0));
        const capturing=owned?owner:(p0>p1?0:p1>p0?1:null);
        const progress=Math.round((owned?1:Math.max(p0,p1))*100);
        const radius=Math.max(2.5,Math.min(14,Number(node.r??node.radius)||6));
        let g=this.objectiveModels.get(key);
        if(!g){g=this.createObjectiveModel({...node,radius,owner,contested,progress},arena);styleFoundryObjective(g,node,arena);g.userData.cocsNode=true;this.objectiveModels.set(key,g);this.worldGroup?.add(g);}
        active.add(key);this.styleCocsModel(g,node);
        const color=contested?'#ffd166':owned?this.objectiveColor(owner,arena):(COCS_NODE_TINTS[archetype]??NEUTRAL);
        const progressColor=contested?'#ffd166':capturing===0||capturing===1?this.objectiveColor(capturing,arena):'#eafff5';
        g.position.set(Number(node.x)||0,Number(node.y)||0,Number(node.z)||0);
        for(const mat of [g.userData.baseMat,g.userData.areaMat,g.userData.beaconMat]){mat.color.set(color);mat.emissive?.set(color);}
        g.userData.progressMat.color.set(progressColor);g.userData.progressMat.emissive?.set(progressColor);
        g.userData.progressMat.opacity=progress>0?1:0;g.userData.progressMat.transparent=true;
        if(g.userData.progressValue!==progress){
         if(software){g.userData.progress.geometry.dispose();g.userData.progress.geometry=new T.RingGeometry(Math.max(.1,radius-.2),radius+.2,32,1,0,Math.PI*2*progress/100);}
         else g.userData.progress.geometry.setDrawRange(0,Math.ceil(progress/100*32)*6);
         g.userData.progressValue=progress;
        }
        g.userData.progress.visible=progress>0;
        const dim=!anchor&&!live,alpha=dim?.38:1;
        for(const mat of [g.userData.baseMat,g.userData.areaMat]){mat.opacity=alpha;mat.transparent=true;}
        if(g.userData.foundryRing)g.userData.areaMat.opacity=alpha*.36;
        g.userData.beacon.visible=anchor||live;
        g.userData.identifier=key;
        g.userData.cocsLive=live;g.userData.cocsContested=contested;g.userData.cocsOwner=owner;
        g.scale.setScalar(reduced||!contested?1:1.03+.05*Math.sin(time*5+(key.length||0)));
       }
       // §6A traversal devices/depots: small always-on beacons tinted by state
       // and owner. Keyed separately from nodes so they follow the same
       // create/dispose lifecycle and never collide with a node id.
       const traversal=this.cocsTraversal(match);
       // Compact traversal snapshots omit Y. Resolve their map anchor on the
       // authored surface so Foundry's beacons/arrival rings are not buried.
       const groundMark=p=>Number.isFinite(p.y)?p.y:(arena.terrain?.height?.(Number(p.x)||0,Number(p.z)||0)??0);
       for(const device of traversal.devices){
        if(!device||device.id===undefined||device.id===null)continue;
        const key=`traversal:device:${device.id}`,deviceState=String(device.state??'live');
        let g=this.objectiveModels.get(key);
        if(!g){g=this.createObjectiveModel({id:key,radius:2.2,owner:null,contested:false,progress:0},arena);styleFoundryObjective(g,device,arena);g.userData.cocsDevice=true;this.objectiveModels.set(key,g);this.worldGroup?.add(g);}
        active.add(key);
        const color=deviceState==='cut'?'#ff6b6b':deviceState==='locked'?'#ffd166':'#7fe3c8';
        for(const mat of [g.userData.baseMat,g.userData.areaMat,g.userData.beaconMat]){mat.color.set(color);mat.emissive?.set(color);}
        g.userData.progress.visible=false;g.userData.beacon.visible=true;
        g.position.set(Number(device.x)||0,groundMark(device),Number(device.z)||0);
        g.userData.identifier=key;g.userData.cocsDeviceState=deviceState;
       }
       for(const depot of traversal.depots){
        if(!depot||depot.id===undefined||depot.id===null)continue;
        const key=`traversal:depot:${depot.id}`,radius=Math.max(3,Math.min(10,Number(depot.radius)||6));
        const owner=depot.owner===0||depot.owner===1?depot.owner:null,contested=depot.contested===true;
        let g=this.objectiveModels.get(key);
        if(!g){g=this.createObjectiveModel({id:key,radius,owner,contested,progress:0},arena);styleFoundryObjective(g,depot,arena);g.userData.cocsDepot=true;this.objectiveModels.set(key,g);this.worldGroup?.add(g);}
        active.add(key);
        const color=contested?'#ffd166':owner===null?NEUTRAL:this.objectiveColor(owner,arena);
        for(const mat of [g.userData.baseMat,g.userData.areaMat,g.userData.beaconMat]){mat.color.set(color);mat.emissive?.set(color);}
        g.userData.progress.visible=false;g.userData.beacon.visible=true;
        g.position.set(Number(depot.x)||0,groundMark(depot),Number(depot.z)||0);
        g.userData.identifier=key;g.userData.cocsDepotOwner=owner;
       }
       // §6A.3 arrival telegraph: a short blue landing ring where a device just
       // dropped an actor. Reduced-motion holds a static ring; nobody relies on
       // the pulse to read the state.
       for(const arrival of traversal.arrivals){
        if(!arrival||arrival.telegraph!==true)continue;
        const key=`traversal:arrival:${arrival.id}`;
        let g=this.objectiveModels.get(key);
        if(!g){g=this.createObjectiveModel({id:key,radius:3.4,owner:null,contested:false,progress:0},arena);styleFoundryObjective(g,arrival,arena);g.userData.cocsArrival=true;this.objectiveModels.set(key,g);this.worldGroup?.add(g);}
        active.add(key);
        for(const mat of [g.userData.baseMat,g.userData.areaMat,g.userData.beaconMat]){mat.color.set('#9fd8ff');mat.emissive?.set('#9fd8ff');}
        g.userData.progress.visible=false;g.userData.beacon.visible=true;
        g.position.set(Number(arrival.x)||0,groundMark(arrival),Number(arrival.z)||0);
        g.userData.identifier=key;g.userData.cocsArrivalSeconds=Number(arrival.remaining)||0;
        g.scale.setScalar(reduced?1:1+Math.sin(time*9+(key.length||0))*.06);
       }
       // Capture/depot/device feedback. The sim events carry ids only, so this
       // compares the markers drawn last frame against this frame: an ownership
       // flip fires once, a device state flip fires once, and nothing runs on a
       // quiet frame. Reduced motion keeps the static ring and skips the sparks.
       const presentation=latticePresentationChanges(this._cocsPresentation,{nodes,depots:traversal.depots,devices:traversal.devices});
       this._cocsPresentation=presentation.next;
       if(!reduced&&(presentation.captures.length||presentation.deviceChanges.length)){
        this.effectPool??=new EffectPool(this.scene);
        const particleScale=this._quality().particles;
        for(const capture of presentation.captures){
         const point={x:capture.x,y:capture.y+1.2,z:capture.z};
         const color=capture.lost?NEUTRAL:this.objectiveColor(capture.owner,arena);
         this._mothFx('effect-capture-ring','arc-burst',point,{size:Math.max(2.6,capture.radius*1.8),opacity:capture.lost?.4:.7,life:.55,slots:3});
         const count=Math.max(2,Math.min(10,Math.round((capture.depot?5:7)*particleScale)));
         for(let i=0;i<count;i++)this.effectPool.add({pos:point,color,endColor:capture.lost?null:'#0d2b26',fade:'smooth',damping:1.6,gravity:5,size:capture.depot?.09:.11,life:.5,velocity:V((Math.random()-.5)*6,Math.random()*4+1,(Math.random()-.5)*6)});
        }
        for(const change of presentation.deviceChanges){
         const point={x:change.x,y:change.y+.8,z:change.z};
         const color=change.to==='cut'?'#ff6b6b':change.to==='locked'?'#ffd166':'#7fe3c8';
         const count=Math.max(2,Math.min(8,Math.round(5*particleScale)));
         for(let i=0;i<count;i++)this.effectPool.add({pos:point,color,endColor:null,fade:'exp',damping:1.8,gravity:6,size:.08,life:.4,wireframe:true,velocity:V((Math.random()-.5)*5,Math.random()*3+.5,(Math.random()-.5)*5)});
        }
       }
       for(const [key,g] of this.objectiveModels)if(!active.has(key)){this.worldGroup?.remove(g);this.disposeObject(g);this.objectiveModels.delete(key);}
      }
        updateObjectives(match,arena=MAPS[0]){const input=match?.objectives??match?.objectiveState;if(input?.kind==='cocs'){this.updateCocsObjectives(match,arena);return;}if(!input||!['koth','domination','assault','payload','extraction'].includes(input.kind)){this.clearObjectiveMarkers();return;}this.objectiveModels??=new Map();const active=new Set(),reduced=this.reduced(),software=this.renderer?.isSoftware===true,assaultActive=input.kind==='assault'&&Number.isFinite(input.active)?input.active:-1;for(const [zoneIndex,zone] of (input.kind==='extraction'?[{id:'extract',x:input.extract?.x,z:input.extract?.z,radius:input.escortRadius??6,progress:input.captureSeconds>0?Math.max(0,Math.min(100,(Number(input.progress)||0)/Number(input.captureSeconds)*100)):0,owner:Number.isInteger(input.escortTeam)?input.escortTeam:null,captureTeam:null,contested:false}]:input.zones||[]).entries()){if(!zone)continue;const key=String(zone.id??active.size),p=pointOf(zone),owner=zone.contested?'contested':zone.owner,capture=zone.captureTeam??zone.owner,progress=Math.max(0,Math.min(100,Number(zone.progress)||0)),radius=Math.max(.8,Number(zone.radius)||3.5);let g=this.objectiveModels.get(key);if(!g){g=this.createObjectiveModel(zone,arena);this.objectiveModels.set(key,g);this.worldGroup?.add(g);}active.add(key);const color=zone.contested?'#ffd166':this.objectiveColor(owner,arena),progressColor=zone.contested?'#ffd166':this.objectiveColor(capture,arena);g.position.set(p.x||0,p.y||0,p.z||0);g.userData.baseMat.color.set(color);g.userData.baseMat.emissive.set(color);g.userData.areaMat.color.set(color);g.userData.areaMat.emissive.set(color);g.userData.beaconMat.color.set(color);g.userData.beaconMat.emissive.set(color);g.userData.progressMat.color.set(progressColor);g.userData.progressMat.emissive.set(progressColor);g.userData.progressMat.opacity=progress>0?1:0;g.userData.progressMat.transparent=true;if(g.userData.radius!==radius){g.userData.area.geometry.dispose();g.userData.area.geometry=new T.CylinderGeometry(radius,radius,.035,32);g.userData.base.geometry.dispose();g.userData.base.geometry=new T.TorusGeometry(radius,.11,6,32);g.userData.progress.geometry.dispose();g.userData.progress.geometry=software?new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progress/100):new T.RingGeometry(radius-.2,radius+.2,32);if(!software)g.userData.progress.geometry.setDrawRange(0,Math.ceil(progress/100*32)*6);g.userData.radius=radius;}if(g.userData.progressValue!==progress){if(software){g.userData.progress.geometry.dispose();g.userData.progress.geometry=new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progress/100);}else g.userData.progress.geometry.setDrawRange(0,Math.ceil(progress/100*32)*6);g.userData.progressValue=progress;}g.userData.progress.visible=progress>0;g.userData.identifier=String(zone.id??'zone');g.userData.emblem.material=g.userData.progressMat;const sectorActive=input.kind==='assault'&&zoneIndex===assaultActive,sectorDim=input.kind==='assault'&&!sectorActive;g.userData.assaultActive=sectorActive;if(input.kind==='assault'){g.userData.areaMat.opacity=sectorDim?.16:1;g.userData.areaMat.transparent=true;g.userData.baseMat.opacity=sectorDim?.32:1;g.userData.baseMat.transparent=true;g.userData.areaMat.emissiveIntensity=sectorActive?1.9:sectorDim?.3:1.25;g.userData.baseMat.emissiveIntensity=sectorActive?2:sectorDim?.35:1.25;if(!g.userData.assaultLabel&&typeof document!=='undefined'&&typeof document.createElement==='function'){const assaultLabel=textLabel(g,String(zone.id??'sector').toUpperCase(),0,2.7,0,.5,sectorActive?'#ffffff':'#95a3ac');assaultLabel.userData.objective=true;assaultLabel.userData.noCameraOcclusion=true;g.userData.assaultLabel=assaultLabel;}if(g.userData.assaultLabel)g.userData.assaultLabel.visible=sectorActive;}g.scale.y=reduced?1:sectorActive?1.04+.1*Math.sin((match.time||0)*5):sectorDim?1:1+.06*Math.sin((match.time||0)*4+(zone.id?.length||0));}for(const [key,g] of this.objectiveModels)if(!active.has(key)){this.worldGroup?.remove(g);this.disposeObject(g);this.objectiveModels.delete(key);}}
     updateVehicleModels(match){const reduced=this.reduced(),now=typeof performance!=='undefined'?performance.now():0;for(const vehicle of match.vehicles||[]){const model=this.vehicleModels?.get(vehicle.id);if(!model)continue;const p=vehicle.position||vehicle,x=p.x??0,y=p.y??0,z=p.z??0,yaw=vehicle.yaw??vehicle.heading??0,health=vehicle.health??1,respawn=vehicle.respawnTimer??0,vehiclePres=this._interpEnabled?this._presentVehicle(vehicle.id):null;model.visible=health>0&&respawn<=0;model.position.set(x,y,z);model.rotation.y=yaw;model.rotation.z=vehicle.roll??0;model.rotation.x=vehicle.pitchBody??vehicle.pitch??0;if(vehiclePres&&!vehiclePres.snapped){model.position.set(vehiclePres.x,vehiclePres.y,vehiclePres.z);model.rotation.y=vehiclePres.yaw;}const speed=Math.hypot(vehicle.vx??0,vehicle.vz??0),stamp=Number.isFinite(match.time)?match.time:now/1000,dt=Math.max(0,Math.min(.1,stamp-(model.userData.spinTime??stamp)));model.userData.spinTime=stamp;const odometer=(model.userData.odometer??0)+speed*dt;model.userData.odometer=odometer;for(const wheel of model.userData.wheels||[])wheel.rotation.x=odometer/.42;const turret=model.userData.turret;if(turret)turret.rotation.y=Number.isFinite(vehicle.turretYaw)?vehicle.turretYaw:0;const heat=vehicle.heat??0,flash=(model.userData.flashUntil??0)>now;for(const gun of model.userData.guns||[]){gun.mount.scale.setScalar(1+heat*.08);gun.flash.visible=!reduced&&flash;}if(!reduced&&(vehicle.boosting===true||((vehicle.boostCooldown??0)>0&&speed>11)||(vehicle.effects?.turbo>0))){if(stamp-(model.userData.lastExhaust??0)>=.04){model.userData.lastExhaust=stamp;this.effectPool??=new EffectPool(this.scene);const backDist=1.35,exX=x+Math.sin(yaw)*backDist,exY=y+.32,exZ=z+Math.cos(yaw)*backDist;this.effectPool.add({pos:V(exX,exY,exZ),color:(vehicle.effects?.turbo>0)?'#ff6622':'#00e5ff',endColor:(vehicle.effects?.turbo>0)?'#ff2200':'#0055ff',fade:'smooth',damping:1.2,size:.14,life:.22,expand:1.5,velocity:V(Math.sin(yaw)*2.5+(Math.random()-.5)*.4,Math.random()*.3,Math.cos(yaw)*2.5+(Math.random()-.5)*.4)});}}}}
     // Riders on a live zipline get a pooled carriage (pulley + yoke) and a
     // reduced-motion-aware spark/wind trail. Presentation only: the pose comes
     // from the authoritative actor, so prediction and resync need no state.
     updateZipRides(match,delta,reduced){const actors=match?.actors;if(!Array.isArray(actors))return;const rides=this.zipCarriages??=new Map(),active=this._zipActive??=new Set();active.clear();const particles=Math.max(.2,Math.min(1.4,this._quality?.().particles??1));for(const a of actors){const ride=a?.zipRide;if(!ride)continue;active.add(a.id);let model=rides.get(a.id);if(!model){model=this._buildZipCarriage();this.scene.add(model);rides.set(a.id,model);model.userData.sparkAt=-Infinity;}const yaw=Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0),x=a.x||0,y=a.y||0,z=a.z||0,fx=-Math.sin(yaw),fz=-Math.cos(yaw);model.position.set(x+fx*.32,y+ZIP_CABLE_HANDLE+.06,z+fz*.32);model.rotation.y=yaw;if(reduced)continue;const time=Number.isFinite(match.time)?match.time:0;if(time-model.userData.sparkAt<ZIP_SPARK_INTERVAL)continue;model.userData.sparkAt=time;this.effectPool??=new EffectPool(this.scene);const speed=Math.max(1,Number(ride.speed)||9),back=.55,sx=x-Math.sin(yaw)*back,sz=z-Math.cos(yaw)*back,count=Math.max(1,Math.round(particles*2));for(let i=0;i<count;i++)this.effectPool.add({from:{x:sx,y:y+.5+i*.2,z:sz},to:{x:sx-Math.sin(yaw)*Math.min(3.2,speed*.24),y:y+.5+i*.2,z:sz-Math.cos(yaw)*Math.min(3.2,speed*.24)},color:'#d8f2ff',life:.09,size:.02,additive:true});this.effectPool.add({pos:V(sx,y+.32,sz),color:'#ffe3a8',endColor:'#8a4a12',fade:'exp',damping:1.5,gravity:3,size:.05,life:.22,velocity:V((Math.random()-.5)*2,(Math.random()-.2)*1.8,(Math.random()-.5)*2)});}for(const [id,model] of rides)if(!active.has(id)){this.scene.remove(model);this.disposeObject(model);rides.delete(id);}}
     _buildZipCarriage(){const g=new T.Group(),metal=material('#39474f',.7,.4),brass=material('#e7b55b',.5,.3,true),wheel=cylinder(g,.075,.075,.05,0,0,0,brass,10),yoke=box(g,.05,.42,.05,0,-.24,0,metal);wheel.rotation.z=Math.PI/2;box(g,.3,.05,.05,0,-.46,0,metal);yoke.userData.zipYoke=true;return g;}
     syncVehicles(match){this.vehicleModels??=new Map();const assets=this.modelAssets??=new ModelAssets();const active=new Set((match.vehicles||[]).map(vehicle=>vehicle.id));for(const [id,model] of this.vehicleModels)if(!active.has(id)){this.scene.remove(model);this.disposeObject(model);this.vehicleModels.delete(id);}for(const vehicle of match.vehicles||[]){if(this.vehicleModels.has(vehicle.id))continue;const model=vehicleModel(vehicle.kind,assets,this.renderer?.isSoftware===true);this.vehicleModels.set(vehicle.id,model);this.scene.add(model);}this._trackAssets(assets);}
    _trackAssets(assets=this.modelAssets){if(!assets)return;const shared=this.sharedResources??=new Set();for(const resource of assets.resources)shared.add(resource);}
    disposeObject(o){if(!o?.traverse)return;const shared=this.renderResources,modelShared=this.sharedResources,geometries=new Set(),materials=new Set(),textures=new Set();o.traverse(n=>{if(n.geometry&&!shared?.has(n.geometry)&&!modelShared?.has(n.geometry))geometries.add(n.geometry);if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])if(!shared?.has(m)&&!modelShared?.has(m)){materials.add(m);for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap','bumpMap','displacementMap','envMap','lightMap','specularMap','gradientMap'])if(m[key]&&!m[key].userData?.surfaceKind&&!m[key].userData?.mothShared)textures.add(m[key]);}});for(const r of [...geometries,...materials,...textures])r.dispose();}
   effect(e){if(!e)return;this.effectPool??=new EffectPool(this.scene);this.feedback??=new WeaponFeedback();const reduced=this.reduced(),info=weaponInfo(e.weapon??0);
   if(e.type==='death'){this.spawnDeath(e,reduced);if(this.killcamEnabled!==false&&!reduced&&e.pos&&(e.actor===this.playerId||this.spectator===true)){const focus={x:e.pos.x||0,y:e.pos.y||0,z:e.pos.z||0},killerModel=e.killer!=null?this.actorModels?.get(e.killer):null,killerPos=killerModel?.position;this._killcam={start:Number.isFinite(e.time)?e.time:0,duration:KILLCAM_DURATION,focus,killer:killerPos?{x:killerPos.x,y:killerPos.y,z:killerPos.z}:null,seed:((Number.isFinite(e.seed)?e.seed:(e.actor??0)*7)>>>0)||1};}}
     const actorModel=this.actorModels?.get(e.actor);
     if(!e.pos&&(e.type.startsWith('flag-')||e.type==='capture')&&actorModel)e={...e,pos:actorModel.position.clone().add(V(0,1,0))};
      // Change only the visual origin; authoritative hit endpoints and camera aim stay untouched.
       if(e.from&&(e.type==='shot'||e.type==='launch')){
        const local=e.actor===this.playerId,weapon=local?(this.hands?.visible?this.firstPerson:null):actorModel?.userData.weapon;
        if(weapon?.userData.type===e.weapon&&weapon.userData.muzzle){
         const muzzle=weapon.userData.muzzle.getWorldPosition(V());
         if(local&&this.camera){
          // The viewmodel muzzle sits below/off the sight line, so the raw muzzle
          // point made shots read from the side of the gun. Project it onto the
          // camera's forward axis at the same depth so the tracer leaves the
          // reticle; authoritative hit endpoints and camera aim stay untouched.
          const forward=V(0,0,-1).applyQuaternion(this.camera.quaternion);
          let depth=Math.max(.05,forward.dot(muzzle.clone().sub(this.camera.position)));
          // A very close impact can sit *in front of* the projected muzzle, which
          // would draw the tracer backwards through the wall. Clamp the visual
          // origin to just before the authoritative impact and flag degenerate
          // traces so the renderer keeps the impact but skips the line.
          const to=e.to||e.pos;
          if(to&&Number.isFinite(to.x)&&Number.isFinite(to.y)&&Number.isFinite(to.z)){
           const impactDepth=forward.dot(V(to.x,to.y,to.z).sub(this.camera.position));
           if(Number.isFinite(impactDepth)){
            const limit=impactDepth-.06;
            if(limit<=.05)e={...e,suppressTrace:true};
            else if(depth>limit)depth=limit;
           }
          }
          e={...e,from:this.camera.position.clone().addScaledVector(forward,depth),muzzleFrom:muzzle};
         }else e={...e,from:muzzle,muzzleFrom:muzzle};
        }
       }
     if(e.type==='shot'||e.type==='vehicle-shot'||e.type==='launch'||e.type==='dash')this.shotEffect(e,info,reduced);
      if(['explosion','death','power','powerup','spawn','jam','flag-pickup','flag-drop','flag-return','capture','vehicle-destroyed'].includes(e.type)){const color=e.type==='explosion'?info.color:e.type==='vehicle-destroyed'?'#ff9944':e.type==='jam'?'#c99aff':e.type==='powerup'?'#ffcf70':e.type.startsWith('flag')||e.type==='capture'?(teamPresentation(e.team,this.display?.teamPalette)?.color??NEUTRAL):e.type==='death'?(CHARACTERS.find(c=>c.id===e.character)?.color??'#fff2ce'):'#74f4de';const impact=info.feel?.impactVisual,particleScale=this._quality().particles,count=(e.type==='death'||e.type==='vehicle-destroyed')&&!reduced?Math.max(1,Math.round(8*particleScale)):1,size=e.type==='death'?.12:e.type==='vehicle-destroyed'?.22:impact==='wide'?.42:impact==='burst'?.34:impact==='ring'?.22:.3;if(e.pos)for(let i=0;i<count;i++)this.effectPool.add({pos:e.pos,color,endColor:e.type==='vehicle-destroyed'?'#441800':e.type==='death'?'#553311':null,fade:'smooth',size,life:e.type==='death'?.5:e.type==='vehicle-destroyed'?.65:impact==='ring'?.4:.3,expand:reduced||e.type==='death'?0:impact==='ring'?1.5:3,wireframe:e.type==='power'||e.type==='powerup'||e.type==='spawn',velocity:(e.type==='death'||e.type==='vehicle-destroyed')&&!reduced?V((Math.random()-.5)*5,Math.random()*4+1,(Math.random()-.5)*5):null});if(e.type==='spawn'&&e.pos)this.effectPool.add({from:{x:e.pos.x,y:e.pos.y,z:e.pos.z},to:{x:e.pos.x,y:(e.pos.y||0)+2.2,z:e.pos.z},color,life:.4,size:.05,additive:true});if(!reduced&&e.pos){if(e.type==='spawn')this._spawnMothSprite('arc-burst',e.pos,{size:1.6,opacity:.55,life:.42,slots:3});else if(e.type==='capture'||e.type==='zone-capture')this._mothFx('effect-capture-ring','arc-burst',e.pos,{size:2.4,opacity:.65,life:.5,slots:3});}}
        if(e.type==='explosion'||e.type==='vehicle-destroyed'){const w=e.weapon??1,fragments=this._quality().particles;if(e.type==='vehicle-destroyed'){if(!reduced)for(let i=0;i<Math.max(1,Math.round(8*fragments));i++)this.effectPool.add({pos:e.pos,color:'#ff9944',endColor:'#331100',fade:'smooth',damping:1.5,gravity:9.8,spin:V((Math.random()-.5)*8,(Math.random()-.5)*8,(Math.random()-.5)*8),size:.14,life:.6,velocity:V((Math.random()-.5)*10,Math.random()*6+2,(Math.random()-.5)*10)});if(e.pos)this.breakPropsAt(e.pos,{radius:5.5,amount:60,serial:(e.id??0)+1,reduced});}else if(w===4){this.effectPool.add({pos:e.pos,color:'#bff4ff',endColor:'#1155aa',fade:'smooth',size:.3,life:.35,expand:reduced?0:1.8});this.effectPool.add({pos:e.pos,color:'#72cfff',endColor:'#002266',fade:'smooth',size:.5,life:.42,expand:reduced?0:2.4});}else if(w===5){if(!reduced)for(let i=0;i<Math.max(1,Math.round(7*fragments));i++)this.effectPool.add({pos:e.pos,color:'#ffb27a',endColor:'#661100',fade:'exp',damping:1.8,gravity:8,spin:V((Math.random()-.5)*6,(Math.random()-.5)*6,(Math.random()-.5)*6),size:.06,life:.5,velocity:V((Math.random()-.5)*9,Math.random()*6,(Math.random()-.5)*9),wireframe:true});}else if(w===1&&!reduced){for(let i=0;i<Math.max(1,Math.round(6*fragments));i++)this.effectPool.add({pos:e.pos,color:'#ffcf9a',endColor:'#ff3300',fade:'smooth',damping:1.6,gravity:9.8,spin:V((Math.random()-.5)*5,(Math.random()-.5)*5,(Math.random()-.5)*5),size:.07,life:.45,velocity:V((Math.random()-.5)*8,Math.random()*5,(Math.random()-.5)*8)});}
         // Blasts shatter nearby crates/barrels. Presentation-only and pooled.
         if(e.pos&&!reduced)this._mothFx('effect-explosion','arc-burst',e.pos,{size:e.type==='vehicle-destroyed'?4.4:3,opacity:.8,life:.5,grow:.6,slots:3});
         if(e.pos&&e.type==='explosion')this.breakPropsAt(e.pos,{radius:w===4?3.4:w===5?4.6:4,amount:w===4?60:45,serial:(e.id??0)+1,reduced});}
     if(e.type==='shot'||e.type==='launch'){const until=performance.now()+(info.feel?.muzzle?.[1]??.06)*1000,model=this.actorModels?.get(e.actor);if(model)model.userData.flashUntil=until;if(e.actor===this.playerId){this.feedback.shot(e.weapon,e.time);this.flashUntil=until;}}if(e.type==='vehicle-shot'){const model=this.vehicleModels?.get(e.vehicle);if(model)model.userData.flashUntil=performance.now()+45;if(e.actor===this.playerId&&e.barrel===0){this.feedback.shot(0,e.time);this.flashUntil=performance.now()+45;}}
       if((e.type==='shot'||e.type==='vehicle-shot')&&!reduced&&this.muzzleLights){const muzzleColor=e.type==='vehicle-shot'?'#ffd166':info.color,muzzleLife=info.feel?.muzzle?.[1]??.06;this.muzzleLights.flash(muzzleColor,e.muzzleFrom??e.from??e.pos,muzzleLife);}
       // Baked sprite accents: traversal teleports flash a portal ring at both
       // ends, and remote muzzle flashes reuse the spark impact sheet so distant
       // fire reads at range. Local fire keeps the viewmodel flash only.
       if(e.type==='teleport'||e.type==='teleporter')this.teleportEffect(e,reduced);
       if(e.type==='zipline'||e.type==='zipline-arrival'||e.type==='zipline-jump')this.ziplineEffect(e,reduced);
       if(e.type==='launcher'||e.type==='launcher-arrival'||e.type==='jump-pad')this.launchEffect(e,reduced);
       if((e.type==='shot'||e.type==='vehicle-shot')&&!reduced&&e.actor!==this.playerId){const muzzle=e.muzzleFrom??e.from;if(muzzle)this._spawnMothSprite('spark-impact',muzzle,{size:e.type==='vehicle-shot'?1.1:.55,opacity:.5,life:.16,slots:3});}
       if(e.type==='damage'){this.applyHitReaction(e,reduced);if(e.shieldBreak){const targetModel=this.actorModels?.get(e.actor),pos=targetModel?targetModel.position:e.pos;if(pos){if(!reduced)this._mothFx('effect-shield',null,{x:pos.x,y:(pos.y||0)+1,z:pos.z},{size:1.5,opacity:.6,life:.4,slots:3});const count=reduced?2:Math.max(4,Math.round(6*this._quality().particles));for(let i=0;i<count;i++)this.effectPool.add({pos:V(pos.x,pos.y+1,pos.z),color:'#70ffe6',endColor:'#104466',fade:'smooth',damping:1.4,gravity:7,spin:V((Math.random()-.5)*10,(Math.random()-.5)*10,(Math.random()-.5)*10),size:.12,life:.32,wireframe:true,velocity:!reduced?V((Math.random()-.5)*5,Math.random()*3+1,(Math.random()-.5)*5):null});}}}
      if(e.type==='mender-heal'&&!reduced)this._mothFx('effect-heal',null,{x:e.x||0,y:(e.y||0)+1,z:e.z||0},{size:Math.max(2,Number(e.radius)||3),opacity:.5,life:.6,slots:3});
       if(e.type==='phalanx-shield'&&!reduced)this._mothFx('effect-shield',null,{x:e.x||0,y:(e.y||0)+1,z:e.z||0},{size:Math.max(2,Number(e.radius)||3),opacity:.55,life:.5,slots:3});
       if(e.type==='pickup'&&!reduced&&['health','megahealth'].includes(e.kind)&&actorModel)this._mothFx('effect-heal',null,actorModel.position,{size:1.1,opacity:.45,life:.4,slots:3});
       if(e.type==='pickup'&&!reduced&&e.kind==='armor'&&actorModel)this._mothFx('effect-shield',null,actorModel.position,{size:1.1,opacity:.45,life:.4,slots:3});
       if(e.type==='powerup'&&e.kind==='overshield'&&!reduced&&e.pos)this._mothFx('effect-shield',null,e.pos,{size:1.6,opacity:.5,life:.5,slots:3});
       if(e.type==='damage'&&e.actor===this.playerId&&Number(e.amount)>=10&&!reduced){this.cameraShake??=new CameraShake();this.cameraShake.add(Math.min(1,Number(e.amount)/70));}
       if(e.type==='death'&&!reduced){this.cameraShake??=new CameraShake();if(e.actor===this.playerId)this.cameraShake.add(1);else{const local=this.actorModels?.get(this.playerId),p=e.pos;if(local&&p){const distance=Math.hypot(local.position.x-(p.x||0),local.position.z-(p.z||0));if(distance<8)this.cameraShake.add(.55*(1-distance/8));}}}
       if(e.type==='vehicle-destroyed'&&!reduced){this.cameraShake??=new CameraShake();const local=this.actorModels?.get(this.playerId),p=e.pos;const wasInside=e.driver===this.playerId||(e.occupants&&e.occupants.includes(this.playerId));if(wasInside)this.cameraShake.add(.85);else if(local&&p){const distance=Math.hypot(local.position.x-(p.x||0),local.position.z-(p.z||0));if(distance<18)this.cameraShake.add(.7*(1-distance/18));}else if(e.actor===this.playerId)this.cameraShake.add(.7);}
       // Optional announcer cue. The audio object owns the voice cap and mute
       // handling; the view only decides which mode events are announceable.
       // LATTICE objective beats join the same channel: a secured capture reads
       // as a capture, a lost one as a neutral objective call, refusals as a
       // low feint, order/terminal/wave completes as objective and the HQ siege
       // as the boss cue.
       const announceType=e.type==='soccer-goal'?'goal':e.type==='zone-capture'?'capture':e.type;
       const latticeCue=latticeAnnounceCue(e,this.playerId);
       if(!reduced&&this.viewAudio?.announcerCue){if(latticeCue)this.viewAudio.announcerCue(latticeCue);else if(['capture','flag-pickup','flag-return','goal'].includes(announceType))this.viewAudio.announcerCue(announceType);}
       if(e.type==='cocs-capture'&&e.participants?.includes(this.playerId)&&!reduced)this._fovPulse=Math.max(this._fovPulse||0,.32);
       // Movement/spec telegraphs (§6.3): wind-ups, movement starts, landings,
       // slam shocks, hooks/ropes and the threat ping. Every branch below is
       // reduced-motion aware.
       if(TELEGRAPH_EVENTS.has(e.type))this.telegraphEffect(e,reduced);
 }
    // Telegraph cues for events that used to be invisible. Presentation only:
    // reads actor models and the event payload, never the simulation. Colours
    // come from the actor's wing palette; reduced motion keeps a static,
    // low-opacity cue and drops every streak/particle.
    // Teleporter beats at BOTH ends: a portal column plus an expanding ring at
    // the entry and exit, sparks for the local rider, and a brief FOV pulse for
    // the local player. Reduced motion keeps the rings and drops particles/FOV.
    teleportEffect(e,reduced){
     const local=e.actor===this.playerId,particles=Math.max(.2,Math.min(1.4,this._quality?.().particles??1));
     if(local&&!reduced)this._fovPulse=Math.max(this._fovPulse||0,.55);
     const ends=e.from? [e.from,...(e.to?[e.to]:[])] : (e.to?[e.to]:[]);
     this.effectPool??=new EffectPool(this.scene);
     ends.forEach((at,index)=>{
      const exit=index>0||(!e.from&&Boolean(e.to)),x=at.x||0,y=at.y||0,z=at.z||0,color=exit?'#bff4ff':'#72e0d0';
      if(!reduced)this._mothFx('effect-teleport','arc-burst',{x,y,z},{size:exit?1.9:1.5,opacity:exit?.75:.65,life:exit?.5:.42,grow:.4,slots:3});
      this.effectPool.add({from:{x,y,z},to:{x,y:y+2.6,z},color,life:.3,size:.07,additive:true});
      this.effectPool.add({pos:{x,y:y+.1,z},color,size:exit?.42:.32,life:.34,expand:reduced?0:1.7});
      if(reduced)return;
      const count=Math.max(2,Math.round(7*particles));
      for(let i=0;i<count;i++)this.effectPool.add({pos:{x,y:y+.4,z},color,size:.05,life:.4,velocity:V((Math.random()-.5)*4.5,Math.random()*4+.6,(Math.random()-.5)*4.5)});
     });
    }
    // Zipline launch, arrival and jump-off beats. The rider's continuous spark/
    // wind trail lives in `updateZipRides`; these are the bookend accents.
    ziplineEffect(e,reduced){
     const at=e.type==='zipline-arrival'?(e.to||e.from):(e.from||e.to);if(!at)return;
     const start=e.type==='zipline',jump=e.type==='zipline-jump',x=at.x||0,y=at.y||0,z=at.z||0,particles=Math.max(.2,Math.min(1.4,this._quality?.().particles??1));
     this.effectPool??=new EffectPool(this.scene);
     if(!reduced&&start)this._mothFx('effect-teleport','arc-burst',{x,y,z},{size:1.1,opacity:.45,life:.3,slots:2});
     this.effectPool.add({pos:{x,y:y+.9,z},color:start?'#ffe3a8':'#cfefff',size:start?.3:.36,life:start?.28:.34,expand:reduced?0:1.3,wireframe:jump});
     if(reduced)return;
     const count=Math.max(2,Math.round((start?7:9)*particles));
     for(let i=0;i<count;i++)this.effectPool.add({pos:{x,y:y+.7,z},color:start?'#ffcf70':'#d8f2ff',endColor:null,fade:'exp',damping:1.6,gravity:start?4:6,size:.055,life:.4,velocity:V((Math.random()-.5)*(start?4:5.5),Math.random()*3+.4,(Math.random()-.5)*(start?4:5.5))});
    }
    // Launcher / jump-pad beats: a directed streak for the arc launch, a lift
    // puff for the pad, and an arrival ring where the flight touches down.
    launchEffect(e,reduced){
     const start=e.type==='launcher',arrival=e.type==='launcher-arrival',at=start?(e.from||e.to):(e.to||e.from);if(!at)return;
     const x=at.x||0,y=at.y||0,z=at.z||0;
     this.effectPool??=new EffectPool(this.scene);
     this.effectPool.add({pos:{x,y:y+.9,z},color:start?'#ffd166':'#bff4ff',size:start?.34:.4,life:start?.3:.34,expand:reduced?0:1.5});
     if(start&&e.to&&!reduced)this.effectPool.add({from:{x,y:y+1,z},to:{x:e.to.x||0,y:(e.to.y||0)+1,z:e.to.z||0},color:'#ffe3a8',life:.24,size:.04,additive:true});
     if(reduced)return;
     const particles=Math.max(.2,Math.min(1.4,this._quality?.().particles??1)),count=Math.max(2,Math.round(7*particles));
     for(let i=0;i<count;i++)this.effectPool.add({pos:{x,y:y+.5,z},color:arrival?'#d8f2ff':'#ffcf70',fade:'exp',damping:1.6,gravity:6,size:.05,life:.35,velocity:V((Math.random()-.5)*4.5,start?Math.random()*4+.6:Math.random()*2.5+.4,(Math.random()-.5)*4.5)});
    }
    telegraphEffect(e,reduced){
     const model=this.actorModels?.get(e.actor),raw=e.pos??model?.position;if(!raw)return false;
     const at=pointOf(raw),feet={x:at.x||0,y:at.y||0,z:at.z||0},chest={x:feet.x,y:feet.y+1.05,z:feet.z};
     const color=model?.userData?.wingColor??'#cfe9ff',fx=this.effectPool??=new EffectPool(this.scene),pool=this.telegraphPool??=new TelegraphPool(this.scene,20);
     const yaw=Number(model?.rotation?.y)||0,fwd={x:-Math.sin(yaw),z:-Math.cos(yaw)},sideAxis={x:-fwd.z,z:fwd.x};
     const ground=(radius,life,opts={})=>pool.spawn({kind:opts.kind??'ring',pos:opts.pos??{x:feet.x,y:feet.y+.06,z:feet.z},color,yaw:opts.yaw??0,radius,life,grow:opts.grow??0,opacity:opts.opacity??.5});
     switch(e.type){
      case 'windup-start':case 'charge-start':{
       // Ring radius/life scale with the wind-up length so a short blink and a
       // long slam charge read differently.
       const charge=e.type==='charge-start',duration=Math.max(.08,Number(e.duration)||.3);
       ground(.5+Math.min(.95,duration*(charge?1.3:.9)),Math.max(.3,duration+(charge?.35:.2)),{grow:reduced?0:(charge?1.1:.7),opacity:reduced?.26:.5});
       if(charge&&!reduced)fx.add({from:{...chest},to:{x:chest.x,y:chest.y+.95,z:chest.z},color,life:duration,size:.05,additive:true});
       if(!reduced)fx.add({pos:{...chest},color,size:.07,life:.2,additive:true});
       break;
      }
      case 'windup-interrupt':{
       ground(.7,.24,{kind:'disc',grow:reduced?0:-.9,opacity:reduced?.18:.4});
       if(!reduced)for(let i=0;i<3;i++)fx.add({pos:{...chest},color,size:.045,life:.22,velocity:V((Math.random()-.5)*3,Math.random()*2-.4,(Math.random()-.5)*3)});
       break;
      }
      case 'move-start':{
       const reason=String(e.reason||''),vertical=reason==='hover'||reason==='super-jump'||reason==='double-jump'||reason==='jump'||reason==='slam';
       if(reduced){ground(.4,.16,{kind:'disc',opacity:.2});break;}
       if(reason==='glide'||reason==='rope'){ground(.55,.3,{kind:'disc',grow:1,opacity:.42});break;}
       for(let i=0;i<3;i++){
        const offset=(i-1)*.2,ox=feet.x+sideAxis.x*offset,oz=feet.z+sideAxis.z*offset;
        if(vertical)fx.add({from:{x:ox,y:feet.y+.6,z:oz},to:{x:ox,y:feet.y+.03,z:oz},color,life:.2,size:.045,additive:true});
        else fx.add({from:{x:ox,y:feet.y+.3+i*.12,z:oz},to:{x:ox-fwd.x*(1+i*.18),y:feet.y+.24+i*.12,z:oz-fwd.z*(1+i*.18)},color,life:.16,size:.05,additive:true});
       }
       fx.add({pos:{x:feet.x,y:feet.y+.3,z:feet.z},color,size:.06,life:.14,additive:true});
       break;
      }
      case 'landing-recovery':{
       // Dust ring scaled by the recovery beat the landing paid for.
       const duration=Math.max(0,Number(e.duration)||0);
       ground(.4+Math.min(.55,duration),.32,{kind:'disc',grow:reduced?0:1.5,opacity:reduced?.28:.46});
       if(!reduced)for(let i=0;i<4;i++)fx.add({pos:{x:feet.x,y:feet.y+.05,z:feet.z},color:'#9fb0b4',size:.05,life:.3,gravity:6,velocity:V((Math.random()-.5)*4.5,Math.random()*1.6,(Math.random()-.5)*4.5)});
       break;
      }
      case 'fuel-empty':{
       if(reduced){fx.add({pos:{...chest},color,size:.035,life:.12,additive:true});break;}
       for(let i=0;i<3;i++)fx.add({pos:{...chest},color,size:.035,life:.24,additive:true,velocity:V((Math.random()-.5)*2.4,Math.random()*1.4,(Math.random()-.5)*2.4)});
       break;
      }
      case 'slam-launch':{
       ground(.55,.3,{grow:reduced?0:1.3,opacity:reduced?.26:.5});
       if(!reduced){fx.add({from:{x:feet.x,y:feet.y,z:feet.z},to:{x:feet.x,y:feet.y+1,z:feet.z},color,life:.2,size:.05,additive:true});for(let i=0;i<4;i++)fx.add({pos:{x:feet.x,y:feet.y+.06,z:feet.z},color,size:.05,life:.3,velocity:V((Math.random()-.5)*5,Math.random()*2.2,(Math.random()-.5)*5)});}
       break;
      }
      case 'slam-impact':{
       const radius=Math.max(.8,Math.min(3.2,(Number(e.radius)||4)*.45));
       ground(radius,.4,{kind:'disc',grow:reduced?0:2.2,opacity:reduced?.28:.5});
       ground(radius*.62,.32,{grow:reduced?0:1.2,opacity:reduced?.28:.55});
       if(!reduced)for(let i=0;i<6;i++)fx.add({pos:{x:feet.x,y:feet.y+.05,z:feet.z},color,size:.06,life:.36,velocity:V((Math.random()-.5)*7,Math.random()*1.6,(Math.random()-.5)*7)});
       break;
      }
      case 'grapple-hook':{
       if(model)model.userData.grappleAnchor={x:feet.x,y:feet.y,z:feet.z};
       ground(.45,.3,{grow:reduced?0:1.2,opacity:reduced?.24:.55});
       if(!reduced)fx.add({from:{...chest},to:{x:feet.x,y:feet.y,z:feet.z},color,life:.16,size:.05,additive:true});
       break;
      }
      case 'grapple-release':{
       const anchor=model?.userData?.grappleAnchor;
       if(anchor&&!reduced)fx.add({from:{...chest},to:{x:anchor.x,y:anchor.y,z:anchor.z},color,life:.12,size:.04,additive:true});
       if(model?.userData?.grappleAnchor)delete model.userData.grappleAnchor;
       ground(.42,.22,{kind:'disc',grow:reduced?0:.8,opacity:reduced?.2:.4});
       if(!reduced)fx.add({pos:{...chest},color,size:.05,life:.14,additive:true});
       break;
      }
      case 'rope-place':{
       const hold=Math.min(12,Math.max(.5,Number(e.life)||20));
       ground(.55,hold,{grow:reduced?0:.05,opacity:reduced?.2:.4});
       if(!reduced){fx.add({from:{x:feet.x,y:feet.y,z:feet.z},to:{x:feet.x,y:feet.y+1.1,z:feet.z},color,life:.35,size:.045,additive:true});for(let i=0;i<3;i++)fx.add({pos:{x:feet.x,y:feet.y+.15,z:feet.z},color,size:.04,life:.3,additive:true,velocity:V((Math.random()-.5)*3,Math.random()*2,(Math.random()-.5)*3)});}
       break;
      }
      case 'rope-expire':{
       ground(.6,.32,{kind:'disc',grow:reduced?0:-1.2,opacity:reduced?.18:.45});
       if(!reduced)fx.add({pos:{x:feet.x,y:feet.y+.1,z:feet.z},color,size:.05,life:.2,additive:true});
       break;
      }
      case 'threat-ping':{
       // Directional warning arc aimed at the source of the bead, plus a small
       // pulse outside it; the arc is the static reduced-motion cue. The event's
       // pos is the target's eye, so anchor the cue at the actor's feet instead.
       const source=this.actorModels?.get(e.source),duration=Math.max(.2,Number(e.duration)||.75),ping=model?pointOf(model.position):feet;
       const dx=source?source.position.x-ping.x:0,dz=source?source.position.z-ping.z:0,aim=Math.atan2(-dx,-dz),pingPos={x:ping.x,y:(ping.y||0)+.06,z:ping.z};
       ground(.95,duration,{kind:'arc',pos:pingPos,grow:0,opacity:reduced?.3:.55,yaw:aim});
       if(!reduced)ground(.5,Math.min(.4,duration),{pos:{...pingPos,y:pingPos.y+.01},grow:1.2,opacity:.4});
       break;
      }
      default:return false;
     }
     return true;
    }
   shotEffect(e,info,reduced){this.effectPool??=new EffectPool(this.scene);const from=e.from,to=e.to??e.pos,weapon=e.weapon??0,feel=info.feel||{},color=e.type==='vehicle-shot'?'#ffd166':(info.color||'#c2ffea'),tracerScale=this._quality().tracers,tracer=feel.tracer||[.085,.055];
    if(e.type==='dash'){if(from&&to)this.effectPool.add({from,to,color:'#c99aff',life:.12,size:.08});return;}
    if(e.type==='launch'){if(to){this.effectPool.add({pos:to,color,size:(feel.muzzle?.[0]||.12)*1.5,life:feel.muzzle?.[1]||.09});this.effectPool.add({pos:to,color:'#ffffff',size:.06,life:.08});}return;}
      if(e.type==='vehicle-shot'){if(from&&to){this.effectPool.add({from,to,color,life:.08,size:.06,additive:true});this.effectPool.add({pos:to,color:'#fff2ce',size:.09,life:.12,expand:reduced?0:.3,additive:true});}return;}
     // A trace whose visual origin was clamped behind a close wall (or that is
     // simply shorter than ~5cm) keeps its impact but drops the backwards line.
     if(e.suppressTrace){if(to)this.impact(weapon,to,color,reduced,e.hit);return;}
     if(!from||!to)return;
     {const dx=(to.x||0)-(from.x||0),dy=(to.y||0)-(from.y||0),dz=(to.z||0)-(from.z||0);if(dx*dx+dy*dy+dz*dz<.0025){this.impact(weapon,to,color,reduced,e.hit);return;}}
    if(weapon===2&&this.railPool){this.railPool.spawn(from,to,color,reduced);this.railImpact(to,color,reduced);return;}
    if(weapon===6){this.lightning(from,to,color,reduced);this.impact(weapon,to,color,reduced,e.hit);return;}
     if(weapon===3||weapon===7){this.effectPool.add({from,to,color,life:.06,size:(weapon===7?.055:.04)*tracerScale,additive:true});this.impact(weapon,to,color,reduced,e.hit);return;}
     if(weapon===8){this.effectPool.add({from,to,color,life:.14,size:.05*tracerScale,additive:true});this.effectPool.add({from,to,color:'#ffffff',life:.06,size:.022*tracerScale,additive:true});this.impact(weapon,to,color,reduced,e.hit);return;}
     if(weapon===9){this.effectPool.add({from,to,color,life:.05,size:.035*tracerScale,additive:true});this.impact(weapon,to,color,reduced,e.hit);return;}
     this.effectPool.add({from,to,color,life:tracer[0],size:tracer[1]*tracerScale,additive:true});this.effectPool.add({from,to,color:'#ffffff',life:tracer[0]*.6,size:Math.max(.022,tracer[1]*.4*tracerScale),additive:true});this.impact(weapon,to,color,reduced,e.hit);
   }
   lightning(from,to,color,reduced){const segments=reduced?5:9,dx=(to.x-from.x)/segments,dy=(to.y-from.y)/segments,dz=(to.z-from.z)/segments,amp=reduced?.05:.16;let px=from.x,py=from.y,pz=from.z;for(let i=0;i<segments;i++){const last=i===segments-1,jitter=last?0:amp,ox=(Math.random()-.5)*jitter,oy=(Math.random()-.5)*jitter,oz=(Math.random()-.5)*jitter,nx=px+dx+ox,ny=py+dy+oy,nz=pz+dz+oz;this.effectPool.add({from:{x:px,y:py,z:pz},to:{x:nx,y:ny,z:nz},color,life:.07,size:.03});this.effectPool.add({from:{x:px,y:py,z:pz},to:{x:nx,y:ny,z:nz},color:'#ffffff',life:.04,size:.012});px=nx;py=ny;pz=nz;}}
    railImpact(pos,color,reduced){this.effectPool.add({pos,color:'#e8f7ff',size:.2,life:.22,expand:reduced?0:.7,wireframe:!reduced});this.effectPool.add({pos,color,size:.12,life:.3,expand:reduced?0:.4});if(!reduced)for(let i=0;i<6;i++)this.effectPool.add({pos,color:'#ffffff',endColor:color,fade:'smooth',damping:2.5,gravity:6,size:.05,life:.24,velocity:V((Math.random()-.5)*7,(Math.random()-.2)*7,(Math.random()-.5)*7)});}
        _spawnImpactDecal(pos,reduced,weapon){if(this.renderer?.isSoftware===true||!pos)return;const limits=this._quality();if(!limits.decals)return;this.decalPool??=new DecalPool(this.scene,limits.decals);const seed=((this._decalSerial=(this._decalSerial??0)+1)*131+(weapon|0)*17)>>>0;this.decalPool.spawn(pos,{color:reduced?'#201a15':'#171310',size:reduced?.24:.32,life:reduced?3.5:6,reduced,seed});}
         impact(weapon,pos,color,reduced,hit){if(!pos)return;const base=hit?'#fff2ce':color;this._spawnImpactDecal(pos,reduced,weapon);if(!reduced)this._spawnMothSprite('spark-impact',pos,{size:hit?.5:.34,opacity:.55,life:.24,slots:3});this.effectPool.add({pos,color:'#fff2ce',size:.055,life:.07,additive:true});if(!reduced)this.effectPool.add({from:{x:pos.x,y:pos.y,z:pos.z},to:{x:pos.x,y:(pos.y||0)+.3,z:pos.z},color:base,life:.1,size:.026,additive:true});if(weapon===3||weapon===7){this.effectPool.add({pos,color:base,size:weapon===7?.13:.1,life:.14,expand:reduced?0:.5});if(!reduced)for(let i=0;i<4;i++)this.effectPool.add({pos,color:'#6b7681',size:.045,life:.3,velocity:V((Math.random()-.5)*6,Math.random()*3,(Math.random()-.5)*6)});return;}if(weapon===6){this.effectPool.add({pos,color:'#dff6ff',size:.11,life:.14,expand:reduced?0:.6});if(!reduced)for(let i=0;i<5;i++)this.effectPool.add({pos,color,size:.04,life:.2,velocity:V((Math.random()-.5)*8,(Math.random()-.5)*8,(Math.random()-.5)*8),wireframe:true});return;}if(weapon===4){this.effectPool.add({pos,color,size:.14,life:.2,expand:reduced?0:1.1});this.effectPool.add({pos,color:'#ffffff',size:.07,life:.14});return;}this.effectPool.add({pos,color:base,size:hit?.09:.055,life:hit?.16:.1,expand:reduced?0:.25});}
  deathFx(){return this.deathPool??=new DeathPool(this.scene,this._quality().deaths,this._quality().splats);}
  spawnDeath(e,reduced){
   if(!e?.pos)return;
   const plan=deathPlan({weapon:e.weapon,overkill:e.overkill,fall:e.fall===true,seed:e.seed??0,actor:e.actor??0});
   this.deathContext.set(e.actor,{plan,pos:e.pos,direction:e.direction??null,start:null});
   const pool=this.deathFx();
   pool.spawn(e.pos,{pieces:plan.pieces,force:plan.force,color:plan.color,reduced,seed:e.seed??0,spin:plan.spin,splay:plan.splay});
   if(plan.gore>0){this.effectPool??=new EffectPool(this.scene);const count=reduced?Math.min(3,plan.gore):plan.gore;for(let i=0;i<count;i++)this.effectPool.add({pos:e.pos,color:plan.color,size:.045+Math.random()*.05,life:.55,velocity:V((Math.random()-.5)*7,Math.random()*5,(Math.random()-.5)*7)});}
   if(e.fall!==true&&!plan.hideBody&&Number.isFinite(e.pos.y))pool.splat({x:e.pos.x,y:e.pos.y-1,z:e.pos.z},{color:plan.energy?'#20343d':'#570c0c',reduced,seed:e.seed??0});
  }
  // ---- Hit reactions -----------------------------------------------------
  // Deterministic, presentation-only flinch/knockback for a non-lethal hit. The
  // plan comes from the pure hitReaction helper; the view only applies the lean
  // to the actor model and spawns directional blood/spark feedback on WebGL.
  // The simulation is never read or written here.
  hitFx(){return this.hitPool??=new HitReactionFX(this.scene,this._quality().deaths);}
  applyHitReaction(e,reduced){
   if(!e||e.actor==null)return null;
   const weapon=Number.isInteger(e.weapon)?e.weapon:null,plan=e.weapon!=null?deathStyleFor({weapon,seed:e.seed??0}):null;
   const energy=plan==='vaporize'||plan==='electrocute',fire=plan==='combust'||plan==='burst';
   const reaction=hitReaction({damage:e.amount,dir:e.direction,seed:e.seed??0,actor:e.actor,serial:e.id??0,reduced,headshot:e.headshot===true,energy,fire});
   (this.hitFlinch??=new Map()).set(e.actor,{strength:reaction.strength,until:(typeof performance!=='undefined'?performance.now():0)+220,lean:reaction.lean,pushX:reduced?0:reaction.pushX,pushZ:reduced?0:reaction.pushZ});
   if(e.pos&&reaction.count>0&&!reduced&&this.renderer?.isSoftware!==true)this.hitFx().spawn(e.pos,reaction,{reduced});
   return reaction;
  }
  // Applied after the actor sync each frame: feeds the rig's existing flinch
  // channel and re-applies the bounded knockback offset while the hit is live.
  _updateHitReactions(){
   if(!this.hitFlinch?.size)return 0;
   const now=typeof performance!=='undefined'?performance.now():0;let live=0;
   for(const [id,state] of this.hitFlinch){
    if(state.until<=now){this.hitFlinch.delete(id);continue;}
    live++;
    const model=this.actorModels?.get(id);if(!model||this.characterLifecycle?.ownsTransform(model))continue;
    model.userData.hitUntil=Math.max(model.userData.hitUntil??0,state.until);
    if(state.pushX||state.pushZ){model.position.x+=state.pushX;model.position.z+=state.pushZ;}
   }
   return live;
  }
  // Final living-only contact pass: after interpolation, styling, swaps and hit pushes.
  _alignLivingCharacters(match){
   const arena=match?.arena??MAPS.find(map=>map.id===match?.mapId)??MAPS[0];
   const sampleGround=(x,z,referenceY)=>typeof this.characterGroundAt==='function'
     ?this.characterGroundAt(x,z,referenceY,match)
     :presentationSupportAt(x,z,arena,referenceY);
   for(const actor of match?.actors??[]){
    const model=this.actorModels?.get(actor.id);
    if(!model||!model.visible||actor.health<=0||actor.vehicleId!=null)continue;
    if(this.characterLifecycle&&this.characterLifecycle.state(model)!=='alive')continue;
    alignLivingCharacter(model,{grounded:actor.grounded!==false,sampleGround});
   }
  }
  poseCorpse(m,a,match){
   const lifecycle=this.characterLifecycle??=new CharacterLifecycle({maxCorpses:24,maxLifetime:4});
   const ctx=this.deathContext?.get(a.id);
   const plan=ctx?.plan??deathPlan({seed:(a.id*7+(a.deaths??0)*13)>>>0});
   lifecycle.update(m,a,{time:match?.time??0,plan,reduced:this.reduced(),hidden:a.id===this.playerId,
    // Override with the shared spatial support selector for stacked platforms.
    // A callback returning null is void and MUST NOT fall back to an invented floor.
    sampleGround:(x,z,referenceY)=>typeof this.characterGroundAt==='function'
      ?this.characterGroundAt(x,z,referenceY,match)
      :presentationSupportAt(x,z,match?.arena??MAPS.find(map=>map.id===match?.mapId)??MAPS[0],referenceY)});
   this.hitFlinch?.delete(a.id);
  }
  reviveCorpse(m,a,match){
   this.characterLifecycle?.update(m,a,{time:match?.time??0});
  }
   // Camera collision for the director's automatically planned shots: cast from
   // the followed actor's head back toward the camera, then ease the stand-off
   // distance in front of whatever blocks the view. Evaluated every frame and
   // smoothed so the camera never alternates between two poses or pops across an
   // obstruction. A director can opt out explicitly with `cameraCollision:false`
   // (e.g. a debug or benchmark rig); the legacy `tour` flag is inert and no
   // longer disables the safety net. Scratch vectors are reused per frame.
   _clearCamera(player,delta,snap){
    if(this.renderer?.isSoftware===true||!this.worldGroup||!player||!this.raycaster)return;
    if(this.director?.cameraCollision===false)return;
    const aim=this.director?.aim,cam=this.camera.position;
    const head=this._camHead??(this._camHead=new T.Vector3());
    if(aim&&Number.isFinite(aim.x)&&Number.isFinite(aim.y)&&Number.isFinite(aim.z))head.set(aim.x,aim.y,aim.z);
    else head.set(player.x||0,(player.y||0)+1.35,player.z||0);
    const dx=head.x-cam.x,dy=head.y-cam.y,dz=head.z-cam.z,dist=Math.hypot(dx,dy,dz);
    if(!(dist>2.2)){this._camWant=undefined;return;}
    const out=this._camOut??(this._camOut=new T.Vector3());
    out.set(-dx/dist,-dy/dist,-dz/dist);
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
   setAudio(audio){this.viewAudio=audio||null;if(audio&&this._modeTheme)audio.setModeTheme?.(this._modeTheme);audio?.setSpace?.(mothSpaceFor(this.mapId));audio?.setEchoMap?.(mothEchoFor(this.mapId));return this.viewAudio;}
   // Victory/defeat sting for the end-of-match screen. The audio object owns the
   // voice cap, mute handling and disposal; the view only forwards the outcome
   // and the active mode theme. Returns the sting result (or null when absent).
   setOutcome(outcome){if(outcome!=='victory'&&outcome!=='defeat')return null;return this.viewAudio?.sting?.(outcome)??null;}
   // Nearby-combat signal for the dynamic music/bed layer. Near action spikes
   // the value to one, then it decays over a fixed window. Pure arithmetic so a
   // caller without audio still gets the same deterministic value.
   audioIntensity(time){
    if(!Number.isFinite(this._nearActionAt))return 0;
    const dt=Number(time)-this._nearActionAt;
    if(!(dt>=0)||dt>5)return 0;
    const decay=1-dt/5,peak=Math.max(0,Math.min(1,this._nearAction||0));
    return Math.max(0,Math.min(1,peak*decay*decay));
   }
   _noteNearAction(audio,time){if(!audio)return;const value=this.audioIntensity(time);if(Math.abs((audio.intensity||0)-value)>.02)audio.setIntensity?.(value);}
   // Swap the procedural gradient material for the map's baked Moth atmosphere.
   // The sky mesh is kept (so updateSky still tracks the camera and _tintSky can
   // still drive stars, sun disc, haze and storm darkening); only the dome's own
   // material is replaced. The gradient material is generated per arena, so it is
   // safe to release here.
   _applyMothAtmosphere(name){
    const mesh=this.sky,sky=mothSkyTexture(name);
    if(!mesh||!sky?.texture)return null;
    const previous=mesh.material;
    mesh.material=new T.MeshBasicMaterial({map:sky.texture,side:T.BackSide,fog:false,depthWrite:false});
    if(previous&&previous!==mesh.material)previous.dispose?.();
    mesh.userData.mothAtmosphere=name;
    return mesh;
   }
   updateSky(){if(this.sky)this.sky.position.copy(this.camera.position);if(this.mountains)this.mountains.position.copy(this.camera.position);}
   // WebGL-only ambient pass: wind sway on tagged vegetation and pooled motes.
   // Both are skipped entirely for the CPU renderer and reduced motion.
   _updateWind(time,reduced){if(this.renderer?.isSoftware===true||reduced||!this.scatterWind?.length)return 0;return updateScatterSway(this.scatterWind,time,{strength:this.windGust(time)});}
   _updateAmbient(match,delta,time,reduced){if(this.renderer?.isSoftware===true||reduced||!this.ambientConfig)return 0;const origin=this.camera?.position;if(!origin)return 0;if(!this.ambientFx){this.ambientPool??=new EffectPool(this.scene,64);this.ambientFx=new AmbientFX(this.ambientPool,{profile:this.ambientConfig,seed:this.ambientSeed??1,anchors:this.ambientAnchors,moteCap:this._quality().ambientMotes});}return this.ambientFx.update(delta,origin,{radius:9,wind:this.windGust(time),intensity:this._effectsScale??1});}
   // Deterministic weather + smooth time-of-day. The clock advances by frame
   // delta and is seeded per arena, so repeated runs produce identical phases.
   // Reduced motion and the CPU renderer still get the tint/sway-free sky blend;
   // only the pooled precipitation pass is gated off for them.
   setWeather(kind){this._weatherOverride=kind==null?null:(WEATHER_KINDS.includes(kind)?kind:null);return this._weatherOverride;}
   initWeather(arena=MAPS[0]){const seed=this.ambientSeed??arenaSeedOf(arena),tod=timeOfDayAt(arena,0,'playing'),reduced=this.reduced?.()===true,preset=this._weatherOverride?weatherPreset(this._weatherOverride):selectWeather(arena,tod,seed,{reduced});this.weatherState={clock:0,kind:preset.kind,preset,wetness:preset.material?.wet??0,applied:-Infinity,phase:tod.phase,timeOfDay:tod,flash:0};this.weatherFx=null;this.weatherPool=null;this._weatherSeed=seed;this._nearActionAt=undefined;this._nearAction=0;this._lightningPreset=null;this._lightning=[];this._lightningAt=0;this._lightningFired=new Set();this._flash=0;this._wetSheenApplied=0;this._wetSheenKind=undefined;this._mothSnowAt=-Infinity;return this.weatherState;}
   _weatherState(){return this.weatherState??(this.weatherState={clock:0,kind:'clear',preset:selectWeather(MAPS[0],'day',1),wetness:undefined,phase:'day',timeOfDay:null,flash:0});}
   _applyArenaLook(state){const base=this._arenaLook;if(!base)return;const palette=skyPalette(base.background,state.phase),material=state.preset?.material||{tint:'#000000',wet:0,dark:0},wet=Math.max(0,Math.min(1,Number(state.wetness)||0)),dark=Math.max(0,Math.min(1,Number(material.dark)||0)),fogScale=Number(state.preset?.density)||1;
    if(this.scene){if(this.scene.background)this.scene.background.copy(new T.Color(base.background)).lerp(new T.Color(material.tint),wet*.5+dark*.5);if(this.scene.fog){this.scene.fog.color.copy(new T.Color(base.fog)).lerp(new T.Color(material.tint),wet*.5+dark*.5);this.scene.fog.density=base.fogDensity*fogScale;}}
    this._applyLookLighting(wet,dark);
    if(this.sky)this._tintSky(this.sky,palette,state.timeOfDay,Math.max(wet,dark));
    // The CPU renderer reads the scalar wetness off scene.userData.sky; the
    // flash scalar is refreshed every frame by _updateLightning.
    if(this.scene?.userData?.sky){this.scene.userData.sky.wet=wet;this.scene.userData.sky.phase=state.phase;}
    if('toneMappingExposure' in this.renderer)this.renderer.toneMappingExposure=base.exposure*(1+(Number(state.preset?.exposure??1)-1)*.85);
   }
   _applyLookLighting(wet,dark){const base=this._arenaLight;if(!base)return;const tint=new T.Color(base.dark||'#000000');for(const light of this.scene?.children||[]){if(light.isHemisphereLight){light.intensity=base.hemi*(1-dark*.22);if(light.color)light.color.copy(base.hemiColor).lerp(tint,wet*.2+dark*.3);if(light.groundColor)light.groundColor.copy(base.groundColor);}else if(light.isDirectionalLight&&!light.userData?.rimLight){light.intensity=base.sun*(1-dark*.5);if(light.color)light.color.copy(base.sunColor).lerp(tint,wet*.3+dark*.55);}}}
   _blendedSkyPalette(blend){const background=this._arenaLook?.background||'#0a0f1e',from=blend?.from||blend?.phase||'day',to=blend?.to||from,k=Number.isFinite(blend?.blend)?Math.max(0,Math.min(1,blend.blend)):0,a=skyPalette(background,from),b=skyPalette(background,to),out={};for(const key of Object.keys(a))out[key]='#'+new T.Color(a[key]).lerp(new T.Color(b[key]),k).getHexString();return out;}
   _tintSky(sky,palette,blend,darken){if(!sky)return;const blended=this._blendedSkyPalette(blend),from=blend?.from||blend?.phase||'day',to=blend?.to||from,k=Number.isFinite(blend?.blend)?Math.max(0,Math.min(1,blend.blend)):0;
    if(sky.userData.stars){const stars=sky.children?.find(child=>child.userData?.stars);if(stars){const nightWeight=g=>g==='night'?1:g==='dusk'?.4:0;const visibility=1-(nightWeight(from)*(1-k)+nightWeight(to)*k);stars.visible=visibility>.4;if(stars.material)stars.material.opacity=Math.max(0,visibility);}}
    const disc=sky.children?.find(child=>child.userData?.sun);if(disc?.material)disc.material.color.copy(new T.Color(blended.disk));
    const haze=sky.children?.find(child=>child.userData?.atmosphere);if(haze?.material)haze.material.color.copy(new T.Color(blended.horizon));
    if(darken>.01&&typeof document!=='undefined'&&!sky.userData.overcast){sky.material=sky.material.clone();sky.material.color.setScalar(1-darken*.42);sky.userData.overcast=true;}
    return blended;
   }
   _updateWeather(arena=MAPS[0],delta=0,mode='playing'){const dt=Math.max(0,Math.min(Number(delta)||0,.25)),state=this._weatherState();state.clock+=dt;
    const tod=timeOfDayAt(arena,state.clock,mode);state.timeOfDay=tod;state.phase=tod.phase;
    // Weather is resolved once per time-of-day phase (or when pinned) so the
    // hash roll never flickers mid-phase; the palette pass only runs when the
    // phase, kind or wetness band actually changes.
    const reducedMotion=this.reduced?.()===true;
    if(state.phase!==tod.phase||this._weatherResolved==null||this._weatherOverride!==this._weatherResolvedOverride){
     const preset=this._weatherOverride?weatherPreset(this._weatherOverride):selectWeather(arena,tod,this._weatherSeed??1,{reduced:reducedMotion});
     state.kind=preset.kind;state.preset=preset;this._weatherResolved=preset.kind;this._weatherResolvedOverride=this._weatherOverride;state.phase=tod.phase;
    }
    const target=state.preset?.material?.wet??0;state.wetness=state.wetness===undefined?target:state.wetness+(target-state.wetness)*(1-Math.exp(-.7*dt));
    if(state.phase!==state.applied||state.kind!==state.appliedKind||Math.abs((state._wetApplied??-1)-state.wetness)>.02||state.clock-state._lookAt>2){state.applied=state.phase;state.appliedKind=state.kind;state._wetApplied=state.wetness;state._lookAt=state.clock;this._applyArenaLook(state);}
    const mood=state.preset?.audio||'default';if(this.viewAudio?.setBedMood&&this._audioMood!==mood){this.viewAudio.setBedMood(mood);this._audioMood=mood;}
    const wind=Number.isFinite(state.preset?.wind)?state.preset.wind:null;if(this.viewAudio?.setWind&&this._audioWind!==wind){this.viewAudio.setWind(wind);this._audioWind=wind;}
    return state;
   }
   _updateWeatherFx(delta,reduced,quality){if(this.renderer?.isSoftware===true||reduced)return 0;const state=this._weatherState();if(!(state.preset?.particles>0))return 0;const origin=this.camera?.position;if(!origin)return 0;if(!this.weatherFx){this.weatherPool??=new EffectPool(this.scene,48);this.weatherFx=new WeatherFX(this.weatherPool,{seed:this._weatherSeed??1,cap:Math.max(2,Math.round((quality?.ambientMotes??3)*2))});}this.weatherFx.setPreset(state.preset);const active=this.weatherFx.update(delta,origin,{radius:10,quality:(quality?.particles??1)*(this._effectsScale??1),software:false,reduced:false});
     // A gentle baked snow drift layered over the particle precipitation. Gated
     // on the snow preset, spawned on a clock cadence so the count is bounded and
     // deterministic; reduced motion and the CPU renderer never reach here.
     if(state.kind==='snow'){this._mothSnowAt=Number.isFinite(this._mothSnowAt)?this._mothSnowAt:-Infinity;if(state.clock>=this._mothSnowAt){this._mothSnowAt=state.clock+1.1;const angle=state.clock*2.399,radius=6+((state.clock*7)%4);this._mothFx('effect-weather-snow',null,{x:origin.x+Math.cos(angle)*radius,y:(origin.y||0)+1.6+Math.sin(angle*1.7)*.6,z:origin.z+Math.sin(angle)*radius},{size:2.6,opacity:.3,life:1.4,slots:2,spin:.15});}}
     return active;}
   // ---- Weather depth: lightning, thunder, wet sheen and wind gusts --------
   // Deterministic storm schedule for the current preset. Rebuilt only when the
   // preset changes so the strikes stay phase-locked across frames.
   _lightningSchedule(preset=this._weatherState().preset){
    const profile=preset?.lightning;if(!profile)return [];
    if(this._lightningPreset!==preset){this._lightningPreset=preset;this._lightningWindow=90;this._lightning=lightningSchedule(preset,{seed:this._weatherSeed??1,window:this._lightningWindow,count:8});this._lightningAt=0;this._lightningFired=new Set();}
    return this._lightning;
   }
   // Advance the storm clock, fire due strikes and expose the current flash
   // envelope. WebGL gets the full schedule; the CPU renderer gets a cheap
   // version (fewer strikes, no thunder) so the software path stays flat.
   _updateLightning(delta,reduced,software){
    const state=this._weatherState(),preset=state.preset;
    if(reduced||!preset?.lightning){
     if((this._flashApplied??0)>0){this._flashApplied=0;this._applyArenaLook(state);}
     this._flash=0;state.flash=0;if(this.scene?.userData?.sky)this.scene.userData.sky.flash=0;return 0;
    }
    const schedule=this._lightningSchedule(preset);
    if(!schedule.length){this._flash=0;state.flash=0;return 0;}
    this._lightningAt=(this._lightningAt||0)+Math.max(0,Math.min(Number(delta)||0,.25));
    // Loop the deterministic schedule so a long storm never runs silent.
    if(this._lightningAt>(this._lightningWindow??90)){this._lightningAt=0;this._lightningFired=new Set();this._lightning=lightningSchedule(preset,{seed:(this._weatherSeed??1)+((this._lightningCycle=(this._lightningCycle??0)+1)>>>0),window:this._lightningWindow,count:8});}
    const firedSet=this._lightningFired??=new Set();
    let fired=0,flash=0;
    for(const strike of schedule){
     const age=this._lightningAt-strike.time;
     if(age>=0&&age<.55){flash=Math.max(flash,strike.intensity*(1-age/.55));if(!firedSet.has(strike)){firedSet.add(strike);fired++;this._onLightningStrike(strike,software);}}
    }
    this._flash=flash;state.flash=flash;
    if(this.scene?.userData?.sky)this.scene.userData.sky.flash=flash;
    if(Math.abs((this._flashApplied??-1)-flash)>.01){
     const was=this._flashApplied??0;this._flashApplied=flash;
     if(flash<=0&&was>0)this._applyArenaLook(state);else this._applyLightningFlash(flash);
    }
    return fired;
   }
   _onLightningStrike(strike,software){
    if(software)return;
    if(this.viewAudio?.thunder)this.viewAudio.thunder({distance:strike.distance,pan:strike.pan,intensity:strike.intensity*(strike.thunderGain??1)});
    // Baked arc burst in the sky: the schedule only carries a normalized
    // distance and stereo pan, so place it on the camera's forward/right axes.
    if(this.renderer?.isSoftware!==true&&this.camera){
     const forward=V(0,0,-1).applyQuaternion(this.camera.quaternion),right=V(1,0,0).applyQuaternion(this.camera.quaternion),distance=90+70*(Number(strike?.distance)||.6),pan=(Number(strike?.pan)||0)*55,pos=this.camera.position.clone().addScaledVector(forward,distance).addScaledVector(right,pan);
     pos.y=Math.max(26,pos.y+30);
     this._spawnMothSprite('arc-burst',pos,{size:11,opacity:.45,life:.34,billboard:false,slots:3});
    }
   }
   // Brighten the exposure and key lights for the flash envelope. Restores the
   // authored look when the flash decays, so no state leaks between strikes.
   _applyLightningFlash(flash){
    const base=this._arenaLook;if(!base)return flash;
    if('toneMappingExposure' in this.renderer)this.renderer.toneMappingExposure=base.exposure*(1+flash*.7);
    for(const light of this.scene?.children||[]){
     if(light.isHemisphereLight)light.intensity=(this._arenaLight?.hemi??light.intensity)*(1+flash*.5);
     else if(light.isDirectionalLight&&!light.userData?.rimLight)light.intensity=(this._arenaLight?.sun??light.intensity)*(1+flash*.8);
    }
    return flash;
   }
   // Apply the wet sheen to floor materials. Runs only on WebGL and only when
   // the wetness band or preset changes, so the per-frame cost is a comparison.
   _applyWetSheen(state){
    if(this.renderer?.isSoftware===true)return false;
    const wet=Math.max(0,Math.min(1,Number(state?.wetness)||0)),look=wetSheen(wet);
    if(Math.abs((this._wetSheenApplied??0)-wet)<.02&&this._wetSheenKind===state?.kind)return false;
    this._wetSheenApplied=wet;this._wetSheenKind=state?.kind;
    const world=this.worldGroup;if(!world)return false;
    const map=wet>0.01&&typeof document!=='undefined'?wetSheenTexture({seed:(this.ambientSeed??1)+13}):null;
    world.traverse(n=>{
     const mat=n.material;if(!mat||Array.isArray(mat)||!mat.isMeshStandardMaterial)return;
     // Snapshot the authored roughness/metalness AND the original roughness map
     // once, so a dry spell restores the exact pre-weather look.
     if(mat.userData?.wetBase===undefined)mat.userData.wetBase={roughness:mat.roughness,metalness:mat.metalness,roughnessMap:mat.roughnessMap??null};
     const base=mat.userData.wetBase;
     mat.roughness=Math.max(0,Math.min(1,base.roughness*look.roughness));
     mat.metalness=Math.max(0,Math.min(1,base.metalness+look.metalness));
     const want=map??base.roughnessMap;
     if(mat.roughnessMap!==want){mat.roughnessMap=want;mat.needsUpdate=true;}
    });
    return true;
   }
   // Deterministic wind gust multiplier for the current time. Feeds vegetation
   // sway and particle drift. The CPU renderer ignores it (its sway is skipped).
   windGust(time){const preset=this._weatherState().preset,strength=Math.max(0,Math.min(2,Number(preset?.wind)||1));return windGustAt(time,{seed:this._weatherSeed??1,strength});}
   // Combat-music signal is fed from the single event-dispatch stage, before the
   // effect loop advances `lastEvent`. This gives the soundtrack its own
   // lifecycle: it never re-reads already-consumed events and never shares the
   // effect cursor (which the effect loop moves past these events).
   _noteCombatEvent(event,time){
    if(!event)return false;
    if(!['shot','vehicle-shot','launch','explosion','death','melee'].includes(event.type))return false;
    const pos=event.pos||event.from;
    const origin=this.actorModels?.get(this.playerId)?.position;
    if(origin&&pos&&Math.hypot((pos.x||0)-origin.x,(pos.z||0)-origin.z)>34)return false;
    this._nearActionAt=time;
    this._nearAction=event.type==='explosion'||event.type==='death'?1:Math.max(this._nearAction||0,.72);
    return true;
   }
   _nearbyAction(match,time){
    const origin=this.actorModels?.get(this.playerId)?.position||this.camera?.position;let proximity=0;
    if(origin)for(const rocket of (match?.rockets||[])){const position=rocket?.pos;if(position&&Math.hypot((position.x||0)-origin.x,(position.z||0)-origin.z)<18)proximity=Math.max(proximity,.85);}
    return Math.max(this.audioIntensity(time),proximity);
   }
   _updateAudio(match,time){const audio=this.viewAudio;if(!audio?.setIntensity)return 0;const value=this._nearbyAction(match,time);if(Math.abs((audio.intensity||0)-value)>.02)audio.setIntensity(value);return audio.intensity||0;}
   setKillcam(on){this.killcamEnabled=on!==false;if(!this.killcamEnabled)this._killcam=null;}
   get killcam(){return this._killcam;}
   killcamActive(){return this._killcam!==null;}
   render(mode,match,delta,time){
    // Reset the (auto-reset-disabled) counters once per presented frame, then
    // account for every pass — world, post and the first-person weapon pass.
    // Optional-chained so a renderer that exposes no reset (or no info at all)
    // degrades to untracked counters instead of throwing every frame.
    this.renderer?.info?.reset?.();
    if(this.perf){this.perf.submitMs=0;this.perf.weaponSubmitMs=0;}
    const perfStart=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    try{return this._renderFrame(mode,match,delta,time);}finally{this._capturePerf(perfStart);}
   }
   _renderFrame(mode,match,delta,time){this.motionQuery??=window.matchMedia?.('(prefers-reduced-motion: reduce)');this.resize();this._sampleQuality(delta);const reduced=this.reduced();this._fovPulse=Math.max(0,(this._fovPulse||0)-Math.max(0,Number(delta)||0)*2);if(mode!==this._lastMode){this._lastMode=mode;this.clearFreeMotion();}if((mode==='selection'||mode==='progression')&&!this.showcaseState){if(this.showcaseExpected){this.renderer.render(this.scene,this.camera);return;}const m=this.menu.model;m.rotation.y=Math.PI+.25+(reduced?0:Math.sin(time*.25)*.2);m.position.y=.17+(reduced?0:Math.sin(time)*.025);m.userData.rig?.update({dt:Math.max(0,Math.min(.1,delta||0)),time,speed:0,maxSpeed:8,grounded:true});this.renderer.render(this.menu.scene,this.menu.camera);return;}if((mode==='selection'||mode==='theater'||mode==='progression'||mode==='changelog'||mode==='browse'||mode==='lobby')&&!match)match=this.showcaseState;
      if(!match)return;const owner=this.cameraOwner,actors=match.actors||[],follow=owner==='manual'&&this.manualFollowId!=null?this.manualFollowId:null,freeCam=owner==='free'&&this._freeCam===true,cinematic=this.cinema===true&&!!this.director&&!freeCam,raceActive=cameraOwnerAllowsRace(owner)&&!this.directorLock&&!!match.race;let player=cinematic?actors[0]:(actors.find(a=>a.id===this.playerId)||actors[0]);if(follow!=null)player=actors.find(a=>a.id===follow)||player;if(!cinematic&&(this.spectator||follow!=null))player=spectateActor(actors,follow??this.spectatorTarget)||player;if(!player)return;const arena=match.arena||MAPS.find(a=>a.id===match.mapId)||MAPS[0];const savedPlayerId=this.playerId;this.updateFlags(match,arena);this.updateObjectives(match,arena);this.updateSpots(match);this.updateWaypoint(match,arena);this.updatePayloadModel(match,arena,time);this.updateMothRift(time);this.updateZipRides(match,Math.max(0,delta),reduced);if(cinematic)this.playerId=-1;const cinemaPose=cinematic?this.director.update(match,Math.max(0,delta),match.events||[]):null;if(freeCam){this.camera.position.set(this.freePose.x,this.freePose.y,this.freePose.z);this.camera.rotation.set(this.freePose.pitch,this.freePose.yaw,0,'YXZ');}else if(cinemaPose&&!raceActive){this.camera.position.set(cinemaPose.x,cinemaPose.y,cinemaPose.z);this.camera.rotation.set(cinemaPose.pitch,cinemaPose.yaw,cinemaPose.roll||0,'YXZ');this._clearCamera(player,delta,cinemaPose.cut);this._applyFreeExitBlend(delta,reduced);}else{const pres=this._interpEnabled?this._presentActor(player.id):null,px=pres&&!pres.snapped?pres.x:(player.x||0),py=pres&&!pres.snapped?pres.y:(player.y||0),pz=pres&&!pres.snapped?pres.z:(player.z||0);const eyeY=py+(player.health>0?(player.eyeHeight??1.45):.65),yaw=(player.yaw||0)+(player.punchYaw||0),pitch=(player.pitch||0)+(player.punchPitch||0);if(this.spectator&&this.spectatorThird===true){const dist=4.6,cos=Math.cos(pitch);this.camera.position.set(px+Math.sin(yaw)*dist*cos,eyeY+1.1-Math.sin(pitch)*dist,pz+Math.cos(yaw)*dist*cos);}else this.camera.position.set(px,eyeY,pz);this.camera.rotation.set(pitch,yaw,0,'YXZ');this._applyFreeExitBlend(delta,reduced);}this.cameraShake??=new CameraShake();const aiming=this.aim===true||player.ads===true,baseFov=this.display?.fov??82;
const activeSight=this._activeSight=resolveActiveSight({weapon:player.weapon,optic:player.attachments?.visual?.optic,aiming});
// Player FOV is updated with the weapon pose below; director/free camera keep ownership here.
if(cinemaPose)this.camera.fov=Math.max(50,Math.min(100,cinemaPose.fov||this.camera.fov));if(freeCam)this.camera.fov=Math.max(50,Math.min(100,this.display?.fov??82));this.camera.updateProjectionMatrix();
if(this._killcam&&!freeCam&&!cinematic&&cameraOwnerAllowsRace(owner)){const elapsed=(Number.isFinite(time)?time:0)-this._killcam.start,kc=killcamPose({elapsed,duration:this._killcam.duration,focus:this._killcam.focus,killer:this._killcam.killer,seed:this._killcam.seed,reduced});if(kc.phase>=1){this._killcam=null;}else{this.camera.position.set(kc.x,kc.y,kc.z);this.camera.lookAt(kc.lookX,kc.lookY,kc.lookZ);this.camera.fov=Math.max(50,Math.min(100,kc.fov));this.camera.updateProjectionMatrix();}}
if(freeCam){this.lowHealthOverlay?.update(false,time,delta,reduced,this.camera);}else if(!cinematic&&cameraOwnerAllowsRace(owner)){this.cameraShake.apply(this.camera,time,reduced,this.display?.cameraShake??1);this.cameraShake.update(Math.max(0,delta));this.lowHealth=player.health>0&&player.health<=(player.maxHealth??100)*.35;this.lowHealthOverlay?.update(this.lowHealth,time,delta,reduced,this.camera);}else this.lowHealthOverlay?.update(false,time,delta,reduced,this.camera);
      actors.forEach((a,i)=>{const m=this.actorModels.get(a.id);if(!m)return;const mounted=a.vehicleId!=null;if(a.health<=0){this.poseCorpse(m,a,match);return;}this.deathContext?.delete(a.id);this.reviveCorpse(m,a,match);m.visible=a.id!==this.playerId;m.position.set(a.x||0,a.y||0,a.z||0);if(mounted){const rider=match.vehicles?.find(v=>v.id===a.vehicleId),chassis=Number.isFinite(rider?.yaw)?rider.yaw:Number.isFinite(rider?.heading)?rider.heading:a.yaw;m.rotation.y=(Number.isFinite(chassis)?chassis:0)-Math.PI;}else m.rotation.y=Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0);const bodyYaw=Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0),speed=Math.hypot(a.vx||0,a.vz||0),localX=(a.vx||0)*Math.cos(bodyYaw)-(a.vz||0)*Math.sin(bodyYaw),localZ=-((a.vx||0)*Math.sin(bodyYaw)+(a.vz||0)*Math.cos(bodyYaw));m.userData.rig?.update({dt:Math.max(0,Math.min(.1,delta||0)),time,reduced,speed:mounted?0:speed,maxSpeed:a.moveSpeed||8,grounded:mounted?true:a.grounded!==false,crouch:!mounted&&a.crouching===true,ads:!mounted&&a.ads===true,reload:!mounted&&a.reloading?1:0,strafe:mounted?0:Math.max(-1,Math.min(1,localX/3)),forward:mounted?0:Math.max(-1,Math.min(1,localZ/3)),focusYaw:Math.atan2(Math.sin((a.yaw||0)-bodyYaw),Math.cos((a.yaw||0)-bodyYaw)),focusPitch:-(a.pitch||0),bank:reduced?0:Math.max(-1,Math.min(1,((a.yaw||0)-bodyYaw)*1.1)),hit:!reduced&&(m.userData.hitUntil??0)>performance.now()?1:0});if(m.userData.gunAnchor){const aimYaw=Math.atan2(Math.sin((a.yaw||0)-bodyYaw),Math.cos((a.yaw||0)-bodyYaw));m.userData.gunAnchor.rotation.x=reduced?0:Math.max(-.7,Math.min(.7,a.pitch||0));m.userData.gunAnchor.rotation.y=reduced?0:Math.max(-.9,Math.min(.9,aimYaw));}if(!reduced&&a.health>0&&a.active>0&&a.harness==='hermes'&&(match.time||0)-(m.userData.trailAt||0)>.1){m.userData.trailAt=match.time;this.effectPool??=new EffectPool(this.scene);this.effectPool.add({pos:V(a.x,a.y+.4,a.z),color:m.userData.color,size:.11,life:.3});}m.userData.torso.material.emissive.set(a.active>0&&['opencode','codex','cline','roo'].includes(a.harness)?m.userData.color:'#000000');m.userData.torso.material.emissiveIntensity=a.active>0?.7:0;const hasEnergyShield=(a.temporaryShield||0)>0||(a.juggernautShield||0)>0;m.userData.shield.material.color.set(a.slow>0?'#d89aff':(a.juggernautShield||0)>0?'#ffd166':hasEnergyShield?'#70ffe6':m.userData.color);m.userData.shield.material.opacity=hasEnergyShield?.24:.13;m.userData.shield.visible=a.slow>0||a.protection>0||(a.harness==='claudecode'&&a.active>0)||hasEnergyShield;if(m.userData.weapon.userData.type!==a.weapon){m.userData.gunAnchor.remove(m.userData.weapon);this.disposeObject(m.userData.weapon);m.userData.weapon=simpleWeaponModel(a.weapon,this.modelAssets,a.attachments?.visual,a.finish);this._trackAssets();m.userData.gunAnchor.add(m.userData.weapon);}m.userData.weapon.userData.flash.visible=!reduced&&(m.userData.flashUntil??0)>performance.now();});
   // Presentation interpolation (opt-in). The host captures a presentation
   // snapshot around every fixed simulation step (including catch-up steps), so
   // the previous/current transforms are the two surrounding ticks rather than
   // whatever the render frame happened to see. Blend by the accumulator
   // fraction; discontinuities snap. Storage is reused, never reallocated here.
   if(this._interpEnabled&&this.actorModels?.size&&this._interpAlpha<1){
    for(const [id,model] of this.actorModels){
     if(this.characterLifecycle&&this.characterLifecycle.state(model)!=='alive')continue;
     const pose=this._presentActor(id);
     if(!pose||pose.snapped)continue;
     model.position.set(pose.x,pose.y,pose.z);
     model.rotation.y=pose.yaw;
    }
   }
   this.updateRace(match,time);
   if(raceActive){if(cinematic)this._raceDemoCamera(match,arena,player,delta,time,reduced);else{const standingsCar=match.race.kind==='soccer'?match.race.standings?.find(r=>r.actorId===player.id)?.vehicleId:null;const car=match.vehicles?.find(v=>v.id===player.vehicleId)||(match.race.kind==='soccer'?(match.vehicles?.find(v=>v.id===standingsCar)||match.vehicles?.[0]):null);if(car){const centerline=arena?.race?.centerline||match.race?.centerline||match.arena?.race?.centerline||[],pose=raceDemoPose({mode:'chase',centerline,vehicle:car});this.camera.position.set(pose.x,pose.y,pose.z);this.camera.lookAt(pose.lookX,pose.lookY,pose.lookZ);}}}
   for(const actor of actors){const model=this.actorModels.get(actor.id);if(model)this.styleActor(model,actor,this.display?.teamPalette);}
   for(const zone of this.objectiveMarkZones(match)){const model=this.objectiveModels?.get(String(zone.id));if(!model)continue;const mark=model.userData.teamMark??=teamMark();if(!mark.parent){mark.position.y=1.45;mark.scale.setScalar(2);model.add(mark);mark.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});}updateTeamMark(mark,zone.contested?null:zone.owner);}
       if((this.qualitySettings?.modelDetail??1)<1)this._applyModelDetail();
    (match.pickups||[]).forEach((p,i)=>{const m=this.pickupModels[i];if(!m)return;m.visible=(p.wait||0)<=0;m.rotation.y=reduced?0:time*.8;m.position.y=(p.y||0)+(reduced?0:Math.sin(time*2+i)*.07);});
   // Persistent projectile markers keep their identity frame to frame, and trail
   // puffs are emitted on a time accumulator (~30 Hz) instead of once per render,
   // so 60 and 144 fps produce roughly the same number of trail particles.
   this.projectilePool??=new EffectPool(this.scene,64);this.projectilePool.clear();
   const trailEm=trailEmissions(this._trailAt,Math.min(Number(delta)||0,.1));this._trailAt=trailEm.remainder;const emitTrail=trailEm.count>0;
   for(const [rocketIndex,r] of (match.rockets||[]).slice(0,64).entries())if(r.pos){const wp=r.weapon??0,pres=this._interpEnabled?this._presentRocket(rocketIndex):null,rp=pres&&!pres.snapped?pres:r.pos;if(wp===4){this.projectilePool.add({pos:rp,color:'#72cfff',size:.2,life:1});this.projectilePool.add({pos:rp,color:'#dff6ff',size:.09,life:1});}else if(wp===5)this.projectilePool.add({pos:rp,color:'#ffb27a',size:.13,life:1});else this.projectilePool.add({pos:rp,color:'#ffad61',size:.15,life:1});if(emitTrail&&!reduced&&this.effectPool&&this.renderer?.isSoftware!==true&&(wp===1||wp===4||wp===5)){this.effectPool.add({pos:V(rp.x,rp.y,rp.z),color:wp===4?'#72cfff':wp===5?'#ffb27a':'#ffad61',endColor:wp===4?'#003366':wp===5?'#551100':'#441100',fade:'smooth',damping:2,size:wp===4?.06:.08,life:.22,expand:1.2,velocity:V((Math.random()-.5)*.6,(Math.random()-.5)*.6,(Math.random()-.5)*.6)});} }
  for(const e of (match.events||[]))if(e.id>this.lastEvent){this._noteCombatEvent(e,time);this.effect(e);this.lastEvent=e.id;}
   this._updateMothSprites(Math.max(0,delta),this.camera);this.effectPool?.update(Math.max(0,delta));this.telegraphPool?.update(Math.max(0,delta));this.railPool?.update(Math.max(0,delta));this.deathPool?.update(Math.max(0,delta));this.decalPool?.update(Math.max(0,delta));
       this.hands.visible=player.health>0&&this.showWeapon!==false&&!this.spectator&&!cinematic&&!freeCam&&follow==null&&player.vehicleId==null;
    const weaponSig=`${player.finish??''}|${weaponVisualKey(player.attachments?.visual)}`;
     if(this.currentWeapon!==player.weapon||this._viewWeaponSig!==weaponSig){
      // Finish any in-flight swap first so models never leak across changes.
      if(this._swap){this._releaseWeapon(this._swap.from);this._swap.to.visible=true;this.firstPerson=this._swap.to;this._swap=null;}
      // Reuse an assembled viewmodel when the same loadout is selected again
      // instead of rebuilding geometry on every switch (the model's geometry is
      // shared through modelAssets, so a cached copy is safe to re-add).
      const next=this._acquireWeapon(player.weapon,player.attachments?.visual,player.finish);
      if(reduced||!this.firstPerson){if(this.firstPerson)this._releaseWeapon(this.firstPerson);this.firstPerson=next;this.hands.add(next);this.firstPerson.visible=true;}
     // Retain the outgoing weapon through the lowering half, swap models at the
     // bottom, then raise the incoming weapon.
     else{this._swap={from:this.firstPerson,to:next,t:0,duration:Math.max(.2,Number(player.weaponSwitch)||.45)};this.hands.add(next);next.visible=false;}
     this.currentWeapon=player.weapon;this._viewWeaponSig=weaponSig;
    }
    this.feedback??=new WeaponFeedback();const pose=this.feedback.update(player,delta,reduced,this.hands.visible,this.display?.weaponBob??1);
    if(this._swap){this._swap.t+=Math.max(0,delta||0);const k=Math.min(1,this._swap.t/this._swap.duration),showIncoming=k>=.5;this._swap.from.visible=!showIncoming;this._swap.to.visible=showIncoming;this.firstPerson=showIncoming?this._swap.to:this._swap.from;if(k>=1){this._releaseWeapon(this._swap.from);this._swap=null;}}
    this._adsController??=new AdsController();
    const ads=this._adsController.update(delta,{
     weapon:player.weapon,aiming,baseFov,sight:activeSight,
     aim:this.firstPerson?.userData?.aim,reduced,reloading:player.reloading===true,
     swapping:!!this._swap,sprinting:player.sprinting===true,
     visible:this.hands.visible&&player.health>0&&!cinematic&&!freeCam&&!this._killcam,
    });
    this._adsTransition=ads.progress;
    this._activeSight={...activeSight,aiming:ads.reticle.ready,adsOpacity:ads.reticle.adsOpacity,hipOpacity:ads.reticle.hipOpacity};
    this._adsController.compose(this.hands.position,this.hands.quaternion,pose,this.feedback.channels);
    // Camera yaw/pitch above remain immediate; no extra camera recoil is added.
    if(!cinematic&&!freeCam&&!this._killcam&&follow==null){this.camera.fov=ads.fov+(reduced?0:(this._fovPulse||0)*6);this.camera.updateProjectionMatrix();}

    this._animateWeaponParts(this.firstPerson,player,reduced);
    this.firstPerson.userData.flash.visible=!reduced&&this.hands.visible&&this.flashUntil>performance.now();this.muzzleLights?.update(Math.max(0,delta));if(this.renderer.shadowMap?.autoUpdate===false){const hz=Number(this._quality().shadowHz)||30;if(shadowDue(time,this._shadowAt,hz)){this._shadowAt=time;this.renderer.shadowMap.needsUpdate=true;}}this.updateSky();this._updateWind(time,reduced);this._updateAmbient(match,delta,time,reduced);const spMode=match.config?.mode==='campaign'||match.config?.mode==='horde';if(spMode)this.setWeather(match.weather??null);else if(!cinematic&&this._weatherOverride!==null)this.setWeather(null);this._updateWeather(arena,delta,mode);this._updateWeatherFx(delta,reduced,this._quality());const software=this.renderer?.isSoftware===true;this._updateLightning(delta,reduced,software);this._applyWetSheen(this._weatherState());this.hitPool?.update(Math.max(0,delta));this._updateHitReactions();this._alignLivingCharacters(match);this._updateDebris(delta);this._updateAudio(match,time);this._beginGpu();if(this.composer)this.composer.render();else this.renderer.render(this.scene,this.camera);
  // Isolated first-person pass: mirror the active camera onto a dedicated
  // weapon camera, clear the world depth, then draw the gun with normal depth
  // testing between its parts. The CPU fallback renders in the main camera.
  if(this.weaponScene&&this.weaponCamera&&this.hands.visible){
   this._markWeaponSubmitStart();
   const wc=this.weaponCamera;wc.position.copy(this.camera.position);wc.quaternion.copy(this.camera.quaternion);wc.fov=this.weaponFov??this.camera.fov;wc.aspect=this.camera.aspect;wc.updateProjectionMatrix();wc.updateMatrixWorld(true);
   this.weaponRoot.position.copy(wc.position);this.weaponRoot.quaternion.copy(wc.quaternion);this.weaponRoot.updateMatrixWorld(true);
   const prevAuto=this.renderer.autoClear;this.renderer.autoClear=false;this.renderer.clearDepth?.();this.renderer.render(this.weaponScene,wc);this.renderer.autoClear=prevAuto;
  }
  // Full-frame GPU query covers world, post and the weapon pass.
  this._endGpu();
  if(cinematic)this.playerId=savedPlayerId;if((mode==='selection'||mode==='progression')&&this.showcaseState)this._renderPreview(time,reduced);}
      // Drive a viewmodel's movable parts from authoritative state: reload
      // progress (magazine/barrel/energy cell) and the WeaponFeedback shot kick
      // (bolt/charging handle). A builder opts in by exposing g.userData.parts;
      // weapons without separate part geometry simply animate their anchors.
      // ---- Viewmodel resource cache + presentation LOD --------------------
      _acquireWeapon(type,visual,finish){
       const key=`${type}|${weaponVisualKey(visual)}|${finish??''}`;
       this._weaponCache??=new Map();
       const cached=this._weaponCache.get(key);
       if(cached&&!cached.parent)return cached;
       const model=weaponModel(type,this.modelAssets??=new ModelAssets(),visual,finish);
       model.scale.setScalar(VIEWMODEL_SCALE);
       model.traverse(n=>{if(n.isMesh){n.renderOrder=100;}});
       model.userData.weaponKey=key;
       if(!cached)this._weaponCache.set(key,model);
       if(this._weaponCache.size>16){for(const [k,m] of this._weaponCache){if(k!==key&&!m.parent){this._weaponCache.delete(k);this.disposeObject(m);break;}}}
       return model;
      }
      _releaseWeapon(model){
       if(!model)return;
       this.hands?.remove(model);
       // A cached viewmodel is kept for reuse; an ad-hoc one (e.g. built while the
       // same key was still attached) is disposed.
       if(model.userData?.weaponKey&&this._weaponCache?.get(model.userData.weaponKey)===model)return;
       this.disposeObject(model);
      }
      // Toggle tagged low-value detail meshes for presentation LOD. The
      // authoritative actors and collision are never affected.
      _setModelDetail(model,detail,distance){
       if(!model?.traverse)return;
       const lod=Number(this.qualitySettings?.lodDistance)||46;
       const near=detail>=.999||distance<=lod*.6,mid=detail>0&&distance<=lod;
       model.traverse(n=>{
        if(!n.userData)return;
        if(n.userData.lodDetail===true)n.visible=near;
        else if(n.userData.lodMid===true)n.visible=mid;
       });
      }
      // ---- Performance accounting ------------------------------------------
       getPerformance(){
        if(!this.perf)return null;
        const info=this.renderer?.info,memory=info?.memory;
        return {...this.perf,renderer:this.rendererInfo(),viewport:{...this.perf.viewport},calls:info?.render?.calls??this.perf.calls,triangles:info?.render?.triangles??this.perf.triangles,geometries:memory?.geometries??this.perf.geometries,textures:memory?.textures??this.perf.textures,programs:info?.programs?.length??this.perf.programs};
       }
       // Backend/GPU identity plus the real drawing-buffer geometry, so a baseline
       // report can name its environment instead of guessing.
       rendererInfo(){
        const out={backend:this.renderer?.isSoftware===true?'software':'webgl',webgl:null,vendor:null,renderer:null,maxTextureSize:null};
        try{const gl=this.renderer?.getContext?.();if(gl){out.webgl=typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext?'webgl2':'webgl';const dbg=gl.getExtension?.('WEBGL_debug_renderer_info');if(dbg){out.vendor=gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);out.renderer=gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);}out.maxTextureSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);}}catch{}
        return out;
       }
        _beginGpu(){const nowFn=(typeof performance!=='undefined'&&performance.now)?performance.now.bind(performance):Date.now;this._gpuCpuStart=nowFn();this._weaponCpuStart=undefined;this.gpuTimer?.begin();}
        // Called when the isolated first-person weapon pass begins so its CPU
        // submission cost is accounted separately from the world/post pass.
        _markWeaponSubmitStart(){this._weaponCpuStart=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();}
        // Ends the full-frame GPU query (world + post + weapon) and records CPU
        // submission for the weapon pass and the whole draw.
        _endGpu(){
         const nowFn=(typeof performance!=='undefined'&&performance.now)?performance.now.bind(performance):Date.now,end=nowFn();
         if(this.perf){
          if(Number.isFinite(this._weaponCpuStart))this.perf.weaponSubmitMs=Math.max(0,end-this._weaponCpuStart);
          if(Number.isFinite(this._gpuCpuStart))this.perf.submitMs=Math.max(0,end-this._gpuCpuStart);
         }
         if(!this.gpuTimer)return;
         this.gpuTimer.end();
         const gpu=this.gpuTimer.poll();
         if(gpu!=null&&this.perf)this.perf.gpuMs=gpu;
        }
       _capturePerf(start){
        if(!this.perf)return;
        const end=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
        const info=this.renderer?.info,memory=info?.memory;
        this.perf.frames++;this.perf.renderMs=Math.max(0,end-start);this.perf.sceneMs=Math.max(0,this.perf.renderMs-this.perf.submitMs);
       if(info){this.perf.calls=info.render?.calls||0;this.perf.triangles=info.render?.triangles||0;this.perf.lines=info.render?.lines||0;this.perf.points=info.render?.points||0;this.perf.programs=info.programs?.length||0;}
       if(memory){this.perf.geometries=memory.geometries||0;this.perf.textures=memory.textures||0;}
       this.perf.passes=this.composer?.passes?.filter(p=>p.enabled!==false).map(p=>p.name||p.constructor?.name||'pass')||[];
      }
      _animateWeaponParts(weapon,player,reduced){
       if(!weapon)return;
       const parts=weapon.userData.parts||{},anchors=weapon.userData.anchors||{};
       const base=node=>{if(node&&node.userData.baseZ===undefined){node.userData.baseX=node.position.x;node.userData.baseY=node.position.y;node.userData.baseZ=node.position.z;node.userData.baseRX=node.rotation.x;node.userData.baseRZ=node.rotation.z;}return node;};
       const mag=base(parts.magazine||anchors.magazine),bolt=base(parts.bolt||anchors.bolt),cell=base(parts.cell||anchors.cell),barrel=base(parts.barrel||anchors.barrel);
       const type=Number.isInteger(player.weapon)?player.weapon:(Number.isInteger(weapon.userData.type)?weapon.userData.type:0);
       if(reduced){
        if(mag)mag.position.set(mag.userData.baseX,mag.userData.baseY,mag.userData.baseZ);
        if(barrel){barrel.position.set(barrel.userData.baseX,barrel.userData.baseY,barrel.userData.baseZ);barrel.rotation.x=barrel.userData.baseRX;}
        if(cell)cell.rotation.z=cell.userData.baseRZ;
        if(bolt)bolt.position.set(bolt.userData.baseX,bolt.userData.baseY,bolt.userData.baseZ);
        return;
       }
       const reloading=player.reloading===true,progress=reloading?Math.max(0,Math.min(1,1-(Number(player.reloadTimer)||0)/(Number(player.reloadDuration)||1))):0,cycle=reloading?Math.sin(progress*Math.PI):0;
       if(mag&&type!==0&&type!==3)mag.position.y=mag.userData.baseY-cycle*(type===1?.12:.24);
       if(barrel&&type===3){barrel.position.y=barrel.userData.baseY-cycle*.1;barrel.rotation.x=barrel.userData.baseRX+cycle*.45;}
       if(cell&&type===2)cell.rotation.z=cell.userData.baseRZ+progress*Math.PI*4;
       if(bolt){const kick=Math.max(0,Math.min(1,Number(this.feedback?.kick)||0));bolt.position.z=bolt.userData.baseZ+kick*.05;}
      }
      updateRace(match,time){syncRacePresentation(this,match,time);}
     _renderPreview(time,reduced){const rect=this.previewRect;if(!rect||rect.width<12||rect.height<12||!(this.renderer instanceof T.WebGLRenderer))return;const m=this.menu.model;m.rotation.y=Math.PI+.25+(reduced?0:Math.sin(time*.4)*.22);m.position.y=.17;const cam=this.menu.camera;cam.aspect=Math.max(.2,rect.width/rect.height);cam.updateProjectionMatrix();this._renderSceneInto(this.renderer,rect,this.menu.scene,cam);}
          dispose(){this.characterLifecycle?.clear();this.clearObjectiveMarkers();this.effectPool?.dispose();this.telegraphPool?.dispose();this.projectilePool?.dispose();this.railPool?.dispose();this.deathPool?.dispose();this.decalPool?.dispose();this.debrisPool?.dispose();this.debrisPool=null;this.hitPool?.dispose();this.hitPool=null;this.hitFlinch?.clear();this.ambientPool?.dispose();this.weatherPool?.dispose();this.ambientFx=null;this.weatherFx=null;this._killcam=null;this.preview?.dispose();this.preview=null;this.previewAssets?.dispose?.();this.previewAssets=null;disposeComposer(this.composer);this.composer=null;this.muzzleLights?.dispose();this.lowHealthOverlay?.dispose();this._disposeMothSprites();this.zipCarriages?.clear();this.disposeObject(this.scene);if(this.weaponScene)this.disposeObject(this.weaponScene);this.disposeObject(this.menu.scene);this.environmentRT?.dispose?.();for(const resource of this.renderResources||[])resource.dispose();this.renderResources?.clear();for(const resource of this.sharedResources||[])resource.dispose();this.sharedResources?.clear();this.modelAssets?.materials.clear();this.modelAssets?.geometries.clear();this.modelAssets?.resources.clear();this.arenaAssets?.materials.clear();this.arenaAssets?.geometries.clear();this.arenaAssets?.resources.clear();clearSurfaceTextures();for(const model of this._weaponCache?.values?.()||[])this.disposeObject(model);this._weaponCache?.clear();this._freeCam=false;this._directorLock=false;this.manualFollowId=null;this._cameraOwner='auto';this._freeExit=null;this.clearFreeMotion();this.resetFreeCam();this.renderer.dispose();}
}
