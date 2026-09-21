import * as T from 'three';
import {SoftwareRenderer} from './software.mjs';
import {CHARACTERS,WEAPONS} from './data.mjs';
import {WINGS,OPERATOR_KITS} from './kits.mjs';
import {aim,presentationSupportAt} from './core.mjs';
import {MAPS,pickupWeapon} from './maps.mjs';
import {normalizeDisplay} from './config.mjs';
import {WeaponFeedback,EffectPool,AmbientFX,WeatherFX} from './feedback.mjs';
import {ModelAssets,withAssets,currentAssets,CameraShake,MuzzleLightPool,LowHealthOverlay,RailBeamPool,DeathPool,DecalPool,RipplePool,ContactShadowPool,HitReactionFX,ShellPool,TelegraphPool,WeaponPreviewRig,killcamPose,KILLCAM_DURATION,AltProjectilePool,altRocketKind,altProjectileColor,FollowMarkerPool,FOLLOW_MARKER_COLOR,KILLER_MARKER_COLOR} from './effects-fx.mjs';
import {createAbilityVfx} from './ability-vfx.mjs';
import {deathPlan,deathStyleFor,hitReaction,hashUnit,fallDuration} from './deaths.mjs';
import {resolveFinish} from './cosmetics.mjs';
import {buildWeaponBody} from './weapon-models/index.mjs';
import {buildAltParts,applyAltMorph} from './weapon-models/alt-parts.mjs';
import {ALT_FIRE,altSpecFor} from './alt-fire.mjs';
import {buildSimpleWeaponBody,chassisFor} from './weapon-models/chassis.mjs';
import {AdsController} from './weapon-ads.mjs';
import {legacyWeaponBody} from './weapon-models/legacy.mjs';
import {CharacterRig} from './character-anim.mjs';
import {CharacterLifecycle,alignLivingCharacter,applyLivingSecondary,ProceduralSpring} from './rig.mjs';
import {refineOperatorCharacter} from './models.mjs';
import {terrainTriangles,terrainWallTriangles} from './terrain.mjs';
import {foundryDetails,styleFoundryObjective} from './lattice-foundry-view.mjs';
import {latticePresentationChanges} from './lattice-feedback.mjs';
import {updateLatticeWorld,clearLatticeWorld} from './lattice-view.mjs';
import {buildInteriors,interiorAt} from './interiors.mjs';
import {smoothNormals,positionColors} from './terrain-normals.mjs';
import {TEAM_PALETTE,teamPresentation,teamMark,updateTeamMark,applyActorTeam} from './team-presentation.mjs';
import {spectateActor,latticeAnnounceCue} from './hud.mjs';
import {NEUTRAL} from './radar.mjs';
import {cavernShell,facadeDetails,tunnelRenderPaths,propId,applyPropDamage,propDamageStage,propBreakPlan,isBreakable} from './structures.mjs';
import {raceDemoMode,raceDemoPose,RACE_DEMO_MODE_SECONDS} from './race-camera.mjs';
import {occlusionDistance} from './camera.mjs';
import {smoothAngle,smoothTowards,smoothFactor,normalizeCameraOwner,cameraOwnerAllowsRace,integrateFreeMove,FREE_CAM_DEFAULT_SPEED,FREE_CAM_BOOST,FREE_CAM_MIN_SPEED,FREE_CAM_MAX_BASE_SPEED} from './camera-modes.mjs';
import {postStage,applyComposerSize,disposeComposer,reducedMotion,normalizeQuality,qualitySettings,qualityIndex,nextQualityTier,QUALITY_LEVELS,frameTriangleBudget,normalizeQualityOverride,bloomResolution,nextQualityState,nextLabBudget,createFrameWindow,pushFrameTime,framePercentiles,hasLayerContent} from './post.mjs';
import {budgetedRatio,nextDynamicScale} from './resolution.mjs';
import {GpuTimer} from './perf.mjs';
import {interpolatePose} from './interpolation.mjs';
import {solveSightPose,attachOptic,sightAlignmentError} from './sights.mjs';
import {resolveActiveSight} from './reticle.mjs';
import {surfaceTextures,clearSurfaceTextures,wetSheenTexture,mothMacroTexture,mothSkyTexture,mothEffectTextures,mothMaterialLutTexture} from './textures.mjs';
import {enhanceMothMaterial} from './moth-surface.mjs';
import {createMothLutMaterial,updateMoth} from './moth-material.mjs';
import {MothSpritePlayer} from './moth-sprite.mjs';
import {addSky,addMountains,addBackdrop,backdropKitFor,addScatter,updateScatterSway,ambientProfile,smokeAnchors,skyPhase,HALO_MAPS,skyPalette,biomeAmbience,selectWeather,timeOfDayAt,weatherPreset,WEATHER_KINDS,lightningSchedule,windGustAt,wetSheen} from './environment.mjs';
import {raceTrackModel,updateRace as syncRacePresentation} from './race-presentation.mjs';
export {raceTrackModel};
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {normalizeGraphicsLab,graphicsLabTargetActive} from './graphics-lab.mjs';
import {GraphicsLabPass} from './graphics-lab-pass.mjs';
import {FinishPass} from './finish-pass.mjs';
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
// Actor models render on a dedicated layer so the world composer can exclude
// them while a bot stack is active. The live camera and the sun's shadow camera
// keep the layer enabled, so direct draws and bot shadows are unchanged.
export const BOT_LAYER=2;
// Shadows are re-rendered on a fixed cadence instead of every frame; the arena
// bake still refreshes immediately on build, and moving actors lag at most one step.
export const SHADOW_REFRESH_INTERVAL=2;
export function shadowTick(previous,interval=SHADOW_REFRESH_INTERVAL){const step=Math.max(1,interval),next=(Number.isFinite(previous)?previous:0)+1;return next>=step?{tick:0,refresh:true}:{tick:next,refresh:false};}
// Elapsed-time shadow scheduling. A per-frame cadence ("every two frames") gets
// more expensive as the refresh rate rises; a fixed Hz budget keeps the cost
// roughly constant across 60/144 Hz.
export function shadowDue(now,last,hz){const period=1/Math.max(1,Number(hz)||30);return !Number.isFinite(last)||now-last>=period;}
// Frame-rate cap for the render loop. `cap` is frames per second and 0 means
// uncapped. This gates presentation only: the host keeps stepping the fixed-dt
// simulation (and the view carries the skipped time into the next drawn frame),
// so gameplay is untouched at 30/60/120. The half-millisecond tolerance absorbs
// rAF jitter without letting a 60 Hz loop through a 120 cap.
export function frameDue(now,last,cap){
 const limit=Number(cap)||0;
 if(!(limit>0))return true;
 if(!Number.isFinite(last))return true;
 return Number(now)-last>=1000/limit-.5;
}
// Camera-following shadow frustum. The arena bake keeps the full-extent fit for
// the first map; in play the ortho camera re-centres on a quantized focus so the
// map spends its texels on a ~40 m view box instead of the whole footprint.
export const SHADOW_FIT_EXTENT=20;
export const SHADOW_FIT_QUANTUM=2;
// Weather particle cap derived from the preset's own particle count (the pure
// emitter releases particles/6 per frame) scaled by the tier's particle budget
// and the independent effects-quality control, instead of ambientMotes*2.
export function weatherParticleCap(preset,quality={},effectsScale=1,limit=48){
 const base=Math.max(0,Number(preset?.particles)||0);
 if(!(base>0))return 0;
 // A missing tier particle budget means "unscaled", not "off"; an explicit zero
 // still suppresses precipitation (the WeatherFX quality scale does the same).
 const tier=quality?.particles,scale=(tier===undefined||tier===null?1:Math.max(0,Number(tier)||0))*Math.max(0,Number(effectsScale)||0);
 return Math.max(2,Math.min(Math.max(2,Math.round(Number(limit)||48)),Math.round(base/3*scale)));
}

// Bloom threshold/radius by tier. Low keeps the historical fixed values exactly;
// higher tiers open the threshold a touch and tighten the radius so the extra
// resolution budget reads as controlled glow rather than a flat wash.
export function bloomTuning(tier=0){
 const level=Number.isFinite(Number(tier))?Number(tier):0;
 if(level<=0)return {threshold:.9,radius:.72};
 if(level===1)return {threshold:.86,radius:.66};
 return {threshold:.82,radius:.6};
}
// Muzzle-light slot budget by tier: 2/3/4 for low/medium/high. High keeps the
// historical four slots, so every pinned high-tier baseline is unchanged.
export function muzzleLightCount(tier=0){
 const level=Number.isFinite(Number(tier))?Number(tier):0;
 return level>=2?4:level>=1?3:2;
}
// Surface-aware impact presentation. `dir` is the authoritative shot direction
// (pointing into the surface) and `ground` the presentation support sample at
// the impact height `y`, so a downward hit only reads as a terrain floor when
// the sampled support actually matches. Wall hits use metal sparks and a cool
// soot tint; terrain floors use dust and a warm dirt tint. Pure: the simulation
// never reads it.
export function impactSurfaceStyle(dir,{ground=null,y=0}={}){
 const dy=Number(dir?.y)||0,steep=!!dir&&Math.abs(dy)>=.6,floor=steep&&dy<0;
 if(!floor)return {floor:false,terrain:false,wall:!!dir,dust:'#6b7681',spark:'#ffcf9a',decal:'#14161c'};
 const terrain=Number.isFinite(ground)&&Math.abs(Number(ground)-(Number(y)||0))<=.3;
 return {floor:true,terrain,wall:false,dust:terrain?'#8a7f6b':'#7d858c',spark:terrain?'#d8c39a':'#ffcf9a',decal:terrain?'#241d14':'#181513'};
}
// Sustained-fire muzzle smoke cadence: one slow grey mote every Nth local shot.
// The period follows the tier particle budget and the effects-quality slider,
// so denser settings read a puff sooner; reduced motion never emits. Zero means
// smoke is disabled for this tier.
export function muzzleSmokePeriod(particles=1,effectsScale=1,reduced=false){
 if(reduced)return 0;
 const scale=Math.max(0,Number(particles)||0)*Math.max(0,Number(effectsScale)||0);
 if(scale>=1)return 3;
 if(scale>=.6)return 4;
 if(scale>=.3)return 6;
 return 0;
}
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
// Drive whichever biome hook the connected audio facade exposes. `SynthAudio`
// owns the high-level `setArenaBiome`; a bare music engine owns the palette
// name, so both are optional calls with the same resolved mood.
function applyArenaBiomePalette(audio,arena){
 if(!audio)return null;
 const mood=biomeAmbience(typeof arena==='string'?{id:arena}:(arena||{})).mood;
 audio.setArenaBiome?.(arena??null);
 if(typeof audio.setBiomePalette==='function')audio.setBiomePalette(mood);
 return mood;
}
// Baked Moth atmosphere per map, applied to the standard sky dome. Maps that are
// not listed keep the procedural addSky gradient. `nebula` is deliberately
// unused: the bake decodes to a fully black equirect (mean/max 0), so wiring it
// would render a black dome instead of an atmosphere.
const MOTH_ATMOSPHERE_MAPS=Object.freeze({
 'ember-caldera':'ember','slagworks':'ember','forge':'ember','ashen-rift':'ember',
 frostline:'frost','frost-gate':'frost',
 'neon-vertical':'void',aether:'void',substation:'void','derelict-station':'void','ironfall-megastructure':'void',
 'moth-backrooms':'void',
});
export function mothAtmosphereFor(arenaId){return MOTH_ATMOSPHERE_MAPS[String(arenaId)]||null;}
// Baked Moth LUT family per arena. Volcanic maps ride the ember LUT, cold
// outposts the ceramic one, the void/neon interiors the deep frustrated LUT, and
// everything else the arcane one. The plain `entanglement` LUT stays on
// flags/pickups so the original bake stays in play (and is the graphics lab's
// default coat). Exported so the mapping is contract-tested like the sky/space
// tables rather than only reachable through a live view instance.
const MOTH_LUT_EMBER=['ember-caldera','slagworks','forge','ashen-rift'];
const MOTH_LUT_VOID=['neon-vertical','aether','substation','derelict-station','ironfall-megastructure','moth-backrooms','crosswire'];
const MOTH_LUT_CERAMIC=['frostline','frost-gate'];
export function mothLutThemeFor(arenaId){const id=String(arenaId??'');if(MOTH_LUT_EMBER.includes(id))return'entanglement-ember';if(MOTH_LUT_VOID.includes(id))return'entanglement-void';if(MOTH_LUT_CERAMIC.includes(id))return'entanglement-ceramic';return'entanglement-arcane';}
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
// Pickup activation colours. Shared by the spawn models in `setMatch` and the
// activation burst, so a pickup always flashes the colour it is built from.
export const PICKUP_COLORS=Object.freeze({health:'#77efba',armor:'#6dbfff',rocket:'#ffb164',rail:'#bf9cff',scatter:'#ffde87',plasma:'#72cfff',grenade:'#ff806b',shock:'#8ce8ff',flak:'#ffd166',marksman:'#ffd27a',smg:'#8affc1',haste:'#72f1b8',overcharge:'#ff8f70',overshield:'#75baff',recon:'#7fe7ff',cloak:'#c8b6ff'});
// One floor tile is 5 m. The material repeat is anchored to that tile instead of
// the arena footprint, so floor texel density (~0.2 tiles/m, matching the terrain
// UV scale) is the same on every map. The repeat stays an integer so neighbouring
// tiles continue the pattern instead of restarting mid-texel.
const FLOOR_TILE=5,FLOOR_TEXTURE_REPEAT=Math.max(1,Math.round(FLOOR_TILE/4));
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
// Per-weapon reload choreography. Every type drives the same named parts
// (magazine/barrel/cell/bolt) but through its own windows so a rocket breech,
// a scattergun break-action and an energy-cell swap do not share one sine.
//   start/end  reload progress window the part travels over
//   travel     peak part travel in model units (mag drop / barrel lift)
//   inspect    progress where the support hand lifts the weapon to inspect
//   bolt       peak carrier stroke from the reload cycle
//   cell       full cell revolutions over the reload
export const RELOAD_TIMING=Object.freeze([
 Object.freeze({start:.12,end:.62,travel:.12,inspect:.68,bolt:.02,cell:0}),  // 0 pulse
 Object.freeze({start:.18,end:.7,travel:.16,inspect:.74,bolt:0,cell:0}),    // 1 rocket breech
 Object.freeze({start:.1,end:.6,travel:.1,inspect:.66,bolt:.025,cell:2}),   // 2 rail cell
 Object.freeze({start:.14,end:.58,travel:.1,inspect:.6,bolt:0,cell:0}),     // 3 scatter break
 Object.freeze({start:.12,end:.62,travel:.14,inspect:.7,bolt:.02,cell:1}),  // 4 plasma pack
 Object.freeze({start:.16,end:.66,travel:.1,inspect:.72,bolt:0,cell:0}),    // 5 grenade drum
 Object.freeze({start:.1,end:.56,travel:.09,inspect:.64,bolt:.03,cell:1}),  // 6 shock capacitor
 Object.freeze({start:.14,end:.64,travel:.12,inspect:.7,bolt:.02,cell:0}),  // 7 flak box
 Object.freeze({start:.1,end:.6,travel:.13,inspect:.74,bolt:.05,cell:0}),   // 8 marksman bolt
 Object.freeze({start:.08,end:.54,travel:.11,inspect:.6,bolt:.03,cell:0}),  // 9 SMG mag
]);
// Frame-time independent window helper: 0 before/after, a single smooth hump
// across [start,end], so a snapshot hitch cannot pop a part.
const reloadWindow=(progress,start,end)=>{
 const t=Math.max(0,Math.min(1,(progress-start)/Math.max(1e-4,end-start)));
 return Math.sin(t*Math.PI);
};
// Weapon-inertia lag. Two scalar springs trail the player's look yaw/pitch and
// are composed on top of the ADS/feedback pose (never into the aim camera).
// Reduced motion snaps to rest; the composed rotation and translation are hard
// bounded so a snapshot teleport cannot swing the viewmodel.
export class WeaponInertia {
 constructor(){
  this.yaw=new ProceduralSpring({frequency:6,damping:.72});
  this.pitch=new ProceduralSpring({frequency:7,damping:.72});
  this.lastYaw=null;this.lastPitch=null;
  this.frame={yaw:0,pitch:0,offsetX:0,offsetY:0,offsetZ:0};
 }
 reset(){this.yaw.snapTo(0);this.pitch.snapTo(0);this.lastYaw=null;this.lastPitch=null;return this.frame;}
 update({dt=0,yaw=0,pitch=0,reduced=false,ads=0,visible=true}={}){
  const frame=this.frame;
  if(reduced||!visible){this.yaw.snapTo(0);this.pitch.snapTo(0);frame.yaw=frame.pitch=frame.offsetX=frame.offsetY=frame.offsetZ=0;this.lastYaw=Number.isFinite(yaw)?yaw:this.lastYaw;this.lastPitch=Number.isFinite(pitch)?pitch:this.lastPitch;return frame;}
  const seconds=Math.max(0,Math.min(.1,Number(dt)||0));
  const yawValue=Number.isFinite(yaw)?yaw:(this.lastYaw??0),pitchValue=Number.isFinite(pitch)?pitch:(this.lastPitch??0);
  const yawRate=seconds>1e-4&&this.lastYaw!==null?clampRate((yawValue-this.lastYaw)/seconds):0;
  const pitchRate=seconds>1e-4&&this.lastPitch!==null?clampRate((pitchValue-this.lastPitch)/seconds):0;
  this.lastYaw=yawValue;this.lastPitch=pitchValue;
  const brace=1-.55*Math.max(0,Math.min(1,Number(ads)||0));
  this.yaw.setTarget(-Math.max(-.06,Math.min(.06,yawRate*.012))*brace);
  this.pitch.setTarget(-Math.max(-.05,Math.min(.05,pitchRate*.01))*brace);
  frame.yaw=Math.max(-.06,Math.min(.06,this.yaw.update(seconds)));
  frame.pitch=Math.max(-.05,Math.min(.05,this.pitch.update(seconds)));
  frame.offsetX=-frame.yaw*.22;frame.offsetY=-frame.pitch*.2;frame.offsetZ=Math.abs(frame.pitch)*.1;
  return frame;
 }
}
const clampRate=rate=>Math.max(-14,Math.min(14,Number.isFinite(rate)?rate:0));

const buildSightError=(rear,front,aim)=>sightAlignmentError(rear,front,aim,VIEWMODEL_SCALE);
function assembleWeapon(type,assets,visual,finish,body){return withAssets(assets,()=>{type=Number.isInteger(type)&&type>=0?type:0;const info=weaponInfo(type),finishColors=resolveFinish(finish,null),g=new T.Group(),dark=material(finishColors?.secondary||'#222f37'),light=material(finishColors?.accent||'#73848a'),glow=material(finishColors?.primary||info.color,.3,.3,true);g.userData.type=type;const ctx={T,info,material,box,cylinder,ring,geo:(key,make)=>geometry(assets,key,make),palette:{dark,light,glow}};body(type,g,ctx);
  // Alt-fire parts are authored hidden and blended in by the view while the
  // snapshot holds `player.alt`; they share the body's cached ctx resources.
  buildAltParts(type,g,ctx);
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
  // First-person support hand. Hidden at rest and during ADS; the reload
  // choreography brings it to the foregrip, travels it with the magazine (or
  // barrel/cell) and lifts the weapon into the inspection tilt. It owns no
  // gameplay anchors, so the ADS solver and grip IK contracts stay untouched.
  {
   const [handWidth,handHeight,handLength,,handY]=chassisFor(type);
   const support=new T.Group();support.name='support-hand';
   support.position.set(-handWidth*.34,handY-handHeight*.82,-handLength*.42);
   const palm=box(support,.072,.088,.076,0,0,0,dark);palm.name='support-palm';
   palm.castShadow=false;palm.receiveShadow=false;
   support.visible=false;g.add(support);g.userData.supportHand=support;
  }
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
  // Sustained-fire barrel heat: one additive sleeve behind the muzzle with its
  // own material, so the per-weapon shot counter can drive it independently of
  // the accent glow. Hidden at rest; the per-frame viewmodel update owns the
  // exponential decay. Reduced motion and the low tier never show it.
  const heatMat=assets?assets.material('weapon-heat-glow',()=>new T.MeshBasicMaterial({color:'#ff5a1f',transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending})):new T.MeshBasicMaterial({color:'#ff5a1f',transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending});
  const heat=new T.Mesh(geometry(assets,'weapon-heat-glow',()=>new T.CylinderGeometry(1,1,1,10,1,true)),heatMat);
  heat.name='heat-glow';heat.rotation.x=Math.PI/2;heat.visible=false;
  const muzzlePoint=anchors[0]?.position??V(0,0,-.83),heatRadius=Math.max(.05,(Number(muzzle[0])||.1)*.8);
  heat.position.set(0,muzzlePoint.y??0,(muzzlePoint.z??0)+.16);
  heat.scale.set(heatRadius,.3,heatRadius);
  g.add(heat);g.userData.heatGlow=heat;g.userData.heat=0;g.userData.heatShots=0;
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
function hornetModelCompact(software=false){const g=new T.Group();g.name='hornet';const hull=material('#3c4652',.7,.4),dark=material('#20262e',.6,.5),accent=material('#ffb35c',.4,.3,true),glass=material('#20323d',.6,.12);
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
// ---- Per-kind vehicle silhouettes -----------------------------------------
// Titan, Scout and Transport share the Puma hull. These additive kits layer a
// readable silhouette (armour skirts, a stripped recon frame, a troop cage) and
// two or three emissive accents on top of it without scaling the model, so the
// shared hull stays the seat-offset reference. Puma never enters this path, so
// its pinned meshes, accessories and guns are untouched.
const VEHICLE_KIT_KINDS=Object.freeze(new Set(['titan','scout','transport']));
export function vehicleKitKind(kind){const id=String(kind||'').toLowerCase();return VEHICLE_KIT_KINDS.has(id)?id:null;}
function buildVehicleKit(g,kit,matc){
 let parts=0;
 const part=node=>{if(node){node.userData.vehicleKit=kit;parts++;}return node;};
 if(kit==='titan'){
  const plate=matc('#454b36',.42,.68),rivet=matc('#8d9583',.7,.4),glow=matc('#ffb35c',.3,.3,true);
  // Armour skirts down both flanks plus a front ram plate. The skirts sit
  // outboard of the tyres so the bolt-on armour never clips the wheels.
  for(const x of [-1.22,1.22]){part(box(g,.14,.5,3.0,x,.55,-.05,plate));
   for(let i=-1;i<=1;i++)part(box(g,.06,.06,.06,x>0?1.28:-1.28,.55,i*1.05,rivet));}
  part(box(g,1.98,.34,.24,0,.5,1.82,plate));
  part(box(g,1.5,.08,1.2,0,1.66,-.2,plate));
  for(const x of [-.62,.62])part(tube(g,x,1.02,-.85,x*1.28,1.62,-1.6,.04,plate,6));
  for(const x of [-1.04,1.04])part(box(g,.34,.2,.7,x,.94,-1.15,plate));
  // Emissive accents: headlight pods, roof rack marker and flank lamps.
  for(const x of [-.42,.42])part(box(g,.2,.12,.12,x,.98,1.66,glow));
  part(box(g,.34,.08,.08,0,1.74,-.78,glow));
  for(const x of [-1.31,1.31])part(box(g,.06,.16,.5,x,.74,-.05,glow));
 }else if(kit==='scout'){
  const frame=matc('#3c444c',.6,.5),trim=matc('#242a30',.45,.6),sensor=matc('#8affc1',.25,.3,true);
  // Stripped frame rails replace the cargo read, with a tall sensor mast.
  for(const x of [-.8,.8])part(box(g,.06,.12,2.2,x,.92,-.2,frame));
  part(tube(g,-.62,.98,.6,.62,.98,.6,.03,trim,6));
  part(tube(g,-.5,1.5,.3,.5,1.5,.3,.03,frame,6));
  part(tube(g,0,1.5,.3,0,2.12,.52,.028,frame,6));
  const dish=new T.Mesh(new T.SphereGeometry(.17,10,6,0,Math.PI*2,0,Math.PI*.5),frame);dish.position.set(0,2.16,.6);dish.rotation.x=Math.PI*.5;dish.userData.vehicleKit=kit;g.add(dish);parts++;
  part(box(g,.1,.07,.1,0,2.3,.6,sensor));
  for(const x of [-.74,.74])part(box(g,.08,.3,.08,x,1.2,-1.2,sensor));
 }else if(kit==='transport'){
  const cage=matc('#4b4f3a',.5,.6),panel=matc('#6d7460',.32,.72),glow=matc('#7fe7ff',.3,.3,true);
  // Rear troop cage over the bed plus full side panels.
  for(const x of [-.72,.72]){part(box(g,.1,.66,1.6,x,.99,-.95,cage));
   for(const z of [-.4,-.95,-1.5])part(box(g,.08,.6,.08,x,.98,z,cage));}
  part(box(g,1.56,.1,1.6,0,1.32,-.95,cage));
  for(const z of [-.4,-.95,-1.5])part(box(g,1.44,.05,.08,0,1.3,z,cage));
  for(const x of [-1.14,1.14])part(box(g,.08,.44,2.0,x,.72,-.35,panel));
  // Emissive accents: cage corner markers and side strips.
  for(const x of [-.72,.72])part(box(g,.16,.08,.4,x,1.4,-.95,glow));
  for(const x of [-1.19,1.19])part(box(g,.06,.08,.9,x,.92,-.5,glow));
 }
 return parts;
}
function hornetModelPoly(software=false){
 const g=new T.Group();g.name='hornet';
 const hull=material('#929eae',.75,.34),dark=material('#202630',.65,.5),panel=material('#101c2b',.45,.58),trim=material('#53677b',.8,.32),accent=material('#ff794b',.4,.3,true),glass=material('#123448',.7,.12);
 // Hornet-only geometry: spherical interceptor cockpit and four solar S-foils.
 const sphere=(parent,r,x,y,z,mat,sx=1,sy=1,sz=1)=>{const mesh=new T.Mesh(new T.SphereGeometry(r,40,28),mat);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);return mesh;};
 const hoop=(parent,r,t,x,y,z,mat)=>{const mesh=new T.Mesh(new T.TorusGeometry(r,t,12,64),mat);mesh.position.set(x,y,z);parent.add(mesh);return mesh;};
 const tube=(parent,a,b,length,x,y,z,mat)=>{const mesh=cylinder(parent,a,b,length,x,y,z,mat,32);mesh.rotation.x=Math.PI/2;return mesh;};
 sphere(g,.88,0,.12,-.3,hull,1,1,1.12);
 sphere(g,.7,0,.12,-.94,glass,1,1,.34);
 hoop(g,.69,.065,0,.12,-1.05,hull);hoop(g,.29,.038,0,.12,-1.185,trim);
 for(let i=0;i<8;i++){const a=i*Math.PI/4;const rib=box(g,.047,.39,.045,Math.sin(a)*.48,.12+Math.cos(a)*.48,-1.13,hull);rib.rotation.z=-a;}
 tube(g,.28,.28,.07,0,.12,-1.2,glass);
 sphere(g,.5,0,.05,.95,hull,1,.75,2.15);
 const nose=new T.Mesh(new T.ConeGeometry(.34,1.55,32),hull);nose.rotation.x=-Math.PI/2;nose.position.set(0,-.3,-1.65);g.add(nose);
 for(const s of [-1,1]){box(g,.08,.1,1.35,s*.27,-.27,-1.55,accent);for(let j=0;j<5;j++)box(g,.16,.08,.08,s*.38,.32,.55+j*.22,dark);}
 hoop(g,.39,.065,0,.05,1.88,trim);tube(g,.28,.32,.12,0,.05,1.92,dark);
 const engines=[],guns=[];
 for(const s of [-1,1])for(const v of [-1,1]){
  const wing=new T.Group();wing.position.set(s*.58,.12,.35);wing.rotation.z=s*v*.48;g.add(wing);
  box(wing,2.35,.15,1.5,s*1.16,0,0,hull);
  // Recessed solar cells on both faces, with structural perimeter and ribs.
  for(const face of [-1,1]){
   box(wing,2.12,.025,1.27,s*1.17,face*.092,0,panel);
   for(let j=0;j<9;j++)box(wing,.022,.027,1.24,s*(.2+j*.24),face*.112,0,trim);
   box(wing,2.12,.028,.032,s*1.17,face*.112,0,trim);
  }
  for(const z of [-.74,.74])box(wing,2.4,.2,.07,s*1.16,0,z,trim);
  box(wing,.1,.21,1.5,s*2.32,0,0,hull);
  tube(wing,.3,.34,1.6,s*.6,0,.4,hull);
  for(const z of [-.41,.95,1.13])hoop(wing,.31,.045,s*.6,0,z,trim);
  tube(wing,.25,.25,.05,s*.6,0,-.43,dark);
  sphere(wing,.11,s*.6,0,-.47,trim,1,1,.5);
  tube(wing,.25,.29,.25,s*.6,0,1.24,dark);
  const glow=tube(wing,.21,.21,.045,s*.6,0,1.38,accent);engines.push(glow);
  hoop(wing,.25,.04,s*.6,0,1.4,hull);
  const mount=new T.Group();mount.position.set(s*2.23,0,-.48);wing.add(mount);
  tube(mount,.14,.18,.65,0,0,-.13,hull);
  const barrel=tube(mount,.065,.09,1.65,0,0,-1.12,dark);
  for(const z of [-.5,-.7,-1.8])hoop(mount,.095,.025,0,0,z,trim);
  tube(mount,.105,.08,.18,0,0,-1.98,hull);
  const flash=new T.Mesh(new T.SphereGeometry(.16,16,12),new T.MeshBasicMaterial({color:'#ffd9a0'}));flash.position.set(0,0,-2.1);flash.visible=false;mount.add(flash);guns.push({mount,barrel,flash});
  box(wing,.16,.035,.35,s*1.96,.135,.48,accent);
 }
 g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
 if(software)addBlobShadow(g,2.8,.32);
 // Match the authored hover/landing clearance of the compact model: the
 // poly hull hangs 0.72m deeper otherwise and would clip the ground.
 for(const child of g.children)child.position.y+=.72;
 g.userData={kind:'hornet',vehicle:true,wheels:[],turret:null,barrels:engines,guns,flashUntil:0,color:'#929eae'};return g;
}

// Titan-only siege model: +Z is forward, with the cannon mouth at the authored
// (0, 1.5, 1.6) muzzle. No shared vehicle geometry or simulation values change.
function titanModel(software=false){
 const g=new T.Group();g.name='titan';
 const armor=material('#626b59',.48,.56),edge=material('#a1a38a',.5,.43),
  dark=material('#252e30',.65,.48),rubber=material('#151b1c',.08,.88),
  steel=material('#8a989d',.8,.3),mark=material('#c9ad68',.3,.6),
  optic=material('#76bcc5',.35,.23,true),lamp=material('#e4cf99',.25,.3,true);
 // Small emissive surfaces only: broad armor highlights come from real bevels.
 const plate=(parent,w,h,d,x,y,z,mat,b=.045)=>{
  b=Math.min(b,w/5,h/5,d/5);
  const geo=geometry(undefined,`titan-bevel|${w}|${h}|${d}|${b}`,()=>{
   const shape=new T.Shape(),a=w/2-b,c=h/2-b,k=Math.min(a,c)*.2;
   shape.moveTo(-a+k,-c);shape.lineTo(a-k,-c);shape.lineTo(a,-c+k);
   shape.lineTo(a,c-k);shape.lineTo(a-k,c);shape.lineTo(-a+k,c);
   shape.lineTo(-a,c-k);shape.lineTo(-a,-c+k);shape.closePath();
   const result=new T.ExtrudeGeometry(shape,{depth:d-2*b,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:3,steps:1,curveSegments:1});
   result.translate(0,0,-d/2+b);return result;
  });
  const mesh=new T.Mesh(geo,mat);mesh.position.set(x,y,z);parent.add(mesh);return mesh;
 };
 const hull=new T.Group();hull.name='siege-armored-hull';g.add(hull);
 plate(hull,2.28,.44,5.1,0,.59,0,dark,.09);
 plate(hull,2.34,.55,4.85,0,.98,0,armor,.1);
 plate(hull,2.3,.28,1.28,0,1.22,1.75,edge,.07).rotation.x=-.16;
 plate(hull,2.25,.25,.32,0,.66,2.52,dark);
 // Three crew access points: paired forward hatches and turret commander hatch.
 for(const s of [-1,1]){
  plate(hull,.68,.1,.74,s*.57,1.36,1.25,armor);
  plate(hull,.37,.1,.12,s*.57,1.44,1.58,dark,.02);
  box(hull,.26,.035,.025,s*.57,1.455,1.648,optic);
  plate(hull,.36,.24,.14,s*.91,1.02,2.43,dark);
  box(hull,.24,.1,.03,s*.91,1.03,2.51,lamp);
  plate(hull,.22,.22,.3,s*.72,.57,2.61,steel);
  // Continuous track beds, articulated shoes and eight exposed road wheels.
  plate(hull,.62,.86,4.98,s*1.18,.52,0,rubber,.12);
  for(let i=0;i<28;i++){
   const z=-2.33+i*(4.66/27);
   for(const y of [.12,.92])plate(hull,.66,.12,.125,s*1.18,y,z,dark,.018);
  }
  for(const end of [-1,1])for(let i=1;i<8;i++){
   const a=-Math.PI/2+i*Math.PI/8;
   const shoe=plate(hull,.66,.12,.15,s*1.18,.52+Math.sin(a)*.4,end*(2.33+Math.cos(a)*.27),dark,.018);
   shoe.rotation.x=end*(Math.PI/2-a);
  }
  // Raised side skirts leave the hubs visible and give filters large value breaks.
  for(let i=0;i<6;i++){
   const z=-2.05+i*.82;
   plate(hull,.18,.48,.73,s*1.43,1.02,z,armor,.04);
   plate(hull,.035,.12,.55,s*1.53,1.13,z,i===4?mark:edge,.008);
   for(const dz of [-.25,.25])cylinder(hull,.035,.035,.035,s*1.54,.91,z+dz,steel,12).rotation.z=Math.PI/2;
  }
  plate(hull,.48,.22,.64,s*.76,1.32,-2.04,dark);
  for(let i=0;i<7;i++)box(hull,.4,.04,.045,s*.76,1.45,-2.28+i*.075,steel);
  cylinder(hull,.12,.14,.48,s*.96,1.04,-2.48,dark,32).rotation.x=Math.PI/2;
  box(hull,.19,.085,.04,s*.89,.91,-2.54,mark);
 }
 const wheels=[];
 for(const s of [-1,1])for(let i=0;i<8;i++){
  const wheel=new T.Group();wheel.position.set(s*1.28,.51,-2.1+i*.6);g.add(wheel);
  cylinder(wheel,.37,.37,.48,0,0,0,rubber,48).rotation.z=Math.PI/2;
  cylinder(wheel,.28,.28,.5,0,0,0,edge,48).rotation.z=Math.PI/2;
  cylinder(wheel,.13,.13,.54,0,0,0,dark,32).rotation.z=Math.PI/2;
  for(let j=0;j<8;j++){
   const a=j*Math.PI/4;
   cylinder(wheel,.025,.025,.035,s*.27,Math.sin(a)*.205,Math.cos(a)*.205,steel,10).rotation.z=Math.PI/2;
  }
  wheels.push(wheel);
 }
 const turret=new T.Group();turret.name='titan-siege-turret';turret.position.set(0,1.5,-.72);g.add(turret);
 cylinder(turret,.89,.96,.2,0,-.19,0,dark,64);
 plate(turret,1.96,.57,1.96,0,.09,-.16,armor,.095);
 for(const s of [-1,1]){
  plate(turret,.46,.45,1.26,s*.84,.14,.17,edge,.065).rotation.y=s*.14;
  plate(turret,.07,.22,.73,s*1.07,.14,-.36,mark,.014);
  // Recessed sight and armored smoke-launcher cluster.
  plate(turret,.3,.23,.32,s*.61,.44,.35,dark);
  box(turret,.21,.095,.025,s*.61,.46,.524,optic);
  for(let i=0;i<3;i++)cylinder(turret,.065,.075,.27,s*.99,.3,-.42-i*.18,dark,24).rotation.z=s*.55;
 }
 cylinder(turret,.36,.38,.09,0,.42,-.48,edge,48);
 plate(turret,.32,.08,.12,0,.51,-.48,dark,.018);
 cylinder(turret,.025,.035,.68,-.7,.69,-.82,dark,16);
 plate(turret,1.42,.36,.42,0,.12,-1.24,dark);
 for(let i=0;i<5;i++)plate(turret,.23,.24,.12,-.52+i*.26,.14,-1.5,armor,.025);
 const mount=new T.Group();mount.name='single-siege-cannon';turret.add(mount);
 plate(mount,.66,.51,.57,0,0,.72,dark,.075);
 const barrel=cylinder(mount,.135,.17,1.25,0,0,1.48,steel,64);barrel.rotation.x=Math.PI/2;
 for(const z of [1.01,1.2,1.82])cylinder(mount,.19,.19,.11,0,0,z,dark,48).rotation.x=Math.PI/2;
 plate(mount,.39,.33,.26,0,0,2.18,edge,.04);
 // A recessed black bore and thick rim, rather than a solid capped gun tip.
 cylinder(mount,.118,.118,.012,0,0,2.315,rubber,48).rotation.x=Math.PI/2;
 ring(mount,.145,.028,0,0,2.32,steel,0);
 const flash=new T.Mesh(new T.SphereGeometry(.23,16,12),new T.MeshBasicMaterial({color:'#ffe1a6'}));
 flash.position.set(0,0,2.32);flash.visible=false;mount.add(flash);
 // Batch stationary detailing by material, retaining independent wheel/turret
// transforms. Source geometry stays in ModelAssets; only temporary clones die.
 const batch=parent=>{
  const buckets=new Map();
  for(const mesh of [...parent.children])if(mesh.isMesh){
   mesh.updateMatrix();const geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();geo.applyMatrix4(mesh.matrix);
   if(!buckets.has(mesh.material))buckets.set(mesh.material,[]);
   buckets.get(mesh.material).push(geo);parent.remove(mesh);
   if(!currentAssets())mesh.geometry.dispose();
  }
  for(const [mat,parts] of buckets){const merged=mergeGeometries(parts,false);for(const part of parts)part.dispose();if(merged)parent.add(new T.Mesh(merged,mat));}
 };
 batch(hull);batch(turret);for(const wheel of wheels)batch(wheel);
 g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
 if(software)addBlobShadow(g,2.8,.35);
 g.userData={kind:'titan',vehicle:true,wheels,turret,barrels:[barrel],guns:[{mount,barrel,flash}],flashUntil:0,color:'#626b59'};
 return g;
}

// Dedicated recon chassis: +Z forward, four animated wheels and one light gun.
// Scout-only cached geometry leaves the shared ground-vehicle draft untouched.
function scoutModel(software=false){
 const g=new T.Group();g.name='scout';
 const hull=material('#708578',.48,.48),edge=material('#c3cbb3',.45,.4),dark=material('#202c30',.55,.56),rubber=material('#101619',.03,.92),metal=material('#91a5ad',.8,.3),seat=material('#424c43',.05,.86),lens=material('#194655',.65,.19),light=material('#b9e9ed',.2,.35,true),tail=material('#e77b4d',.2,.45,true);
 // Broad chamfers catch lighting and outlines without relying on tiny textures.
 const panel=(parent,w,h,d,x,y,z,mat,b=.035)=>{
  const key=`scout-bevel|${w}|${h}|${d}|${b}`;
  const geo=geometry(undefined,key,()=>{
   const s=new T.Shape(),a=w/2-b,c=h/2-b;
   s.moveTo(-a,-h/2);s.lineTo(a,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-c);s.lineTo(w/2,c);s.quadraticCurveTo(w/2,h/2,a,h/2);s.lineTo(-a,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,c);s.lineTo(-w/2,-c);s.quadraticCurveTo(-w/2,-h/2,-a,-h/2);
   const result=new T.ExtrudeGeometry(s,{depth:d-2*b,steps:1,bevelEnabled:true,bevelSegments:3,bevelSize:b*.45,bevelThickness:b,curveSegments:8});result.translate(0,0,-d/2+b);return result;
  });
  const m=new T.Mesh(geo,mat);m.position.set(x,y,z);parent.add(m);return m;
 };
 const torus=(parent,r,t,x,y,z,mat,side=false)=>{const m=new T.Mesh(geometry(undefined,`scout-torus|${r}|${t}`,()=>new T.TorusGeometry(r,t,12,48)),mat);m.position.set(x,y,z);if(side)m.rotation.y=Math.PI/2;parent.add(m);return m;};
 panel(g,.78,.16,1.77,0,.32,0,dark);
 panel(g,.72,.22,1.35,0,.44,-.08,hull);
 const hood=panel(g,.74,.17,.62,0,.58,.64,hull);hood.rotation.x=.12;
 panel(g,.38,.055,.46,0,.682,.63,edge,.014);
 panel(g,.82,.1,.13,0,.37,1.01,metal,.02);
 panel(g,.68,.14,.06,0,.49,.98,dark,.012);
 for(let i=-3;i<=3;i++)box(g,.025,.09,.015,i*.075,.49,1.018,metal);
 // Staggered two-place cockpit follows the driver's and passenger's seat layout.
 for(const [x,z] of [[-.2,.1],[.2,-.5]]){
  panel(g,.28,.09,.32,x,.52,z,seat,.018);
  const back=panel(g,.28,.33,.085,x,.7,z-.15,seat,.02);back.rotation.x=-.13;
  panel(g,.18,.105,.08,x,.91,z-.18,dark,.018);
  for(const dx of [-.075,.075])box(g,.035,.25,.015,x+dx,.72,z-.093,dark);
 }
 panel(g,.62,.12,.13,0,.71,.35,dark,.02);
 torus(g,.095,.015,-.2,.78,.27,metal).rotation.x=.6;
 panel(g,.15,.065,.018,-.13,.752,.275,lens,.007);
 for(const s of [-1,1]){
  tube(g,s*.34,.47,.48,s*.34,1.04,.24,.023,metal,16);
  tube(g,s*.34,1.04,.24,s*.34,1.04,-.63,.023,metal,16);
  tube(g,s*.34,1.04,-.63,s*.36,.49,-.94,.023,metal,16);
  tube(g,s*.38,.46,.37,s*.38,.46,-.66,.027,dark,16);
  panel(g,.07,.16,.58,s*.365,.49,-.22,hull,.016);
  panel(g,.13,.07,.15,s*.27,.61,.965,light,.014);
  panel(g,.15,.06,.035,s*.27,.52,-.96,tail,.01);
 }
 for(const z of [.24,-.63])tube(g,-.34,1.04,z,.34,1.04,z,.023,metal,16);
 tube(g,-.34,1.04,-.63,.34,.51,-.94,.018,dark,16);
 // Independent wishbones, dampers, smooth rounded tires and actual tread blocks.
 const wheels=[];
 for(const x of [-.45,.45])for(const z of [-.75,.75]){
  const s=Math.sign(x),wheel=new T.Group();wheel.position.set(x,.245,z);g.add(wheel);wheels.push(wheel);
  torus(wheel,.174,.071,0,0,0,rubber,true);
  cylinder(wheel,.132,.132,.137,0,0,0,dark,48).rotation.z=Math.PI/2;
  cylinder(wheel,.105,.105,.15,0,0,0,metal,32).rotation.z=Math.PI/2;
  cylinder(wheel,.045,.045,.165,0,0,0,dark,24).rotation.z=Math.PI/2;
  for(let i=0;i<24;i++)for(const row of [-1,1]){
   const a=i*Math.PI/12+row*.055;
   const tread=box(wheel,.064,.024,.051,row*.036,Math.cos(a)*.239,Math.sin(a)*.239,rubber);tread.rotation.x=a;tread.rotation.y=row*.22;
  }
  for(let i=0;i<6;i++){const a=i*Math.PI/3;cylinder(wheel,.009,.009,.012,s*.083,Math.cos(a)*.071,Math.sin(a)*.071,dark,12).rotation.z=Math.PI/2;}
  for(const dz of [-.13,.13])tube(g,s*.2,.34,z+dz,x,.245,z,.018,metal,16);
  tube(g,s*.26,.51,z-.05,x,.27,z,.026,dark,20);
  tube(g,s*.29,.45,z-.035,x,.27,z,.012,metal,16);
  const arch=new T.Mesh(geometry(undefined,'scout-fender',()=>new T.TorusGeometry(.275,.026,10,40,Math.PI)),hull);arch.rotation.y=Math.PI/2;arch.position.set(x,.245,z);g.add(arch);
 }
 // Rear powerpack and a compact optics mast communicate scouting, not heavy armor.
 panel(g,.55,.14,.25,0,.57,-.84,hull,.025);
 for(let i=-2;i<=2;i++)box(g,.065,.015,.18,i*.087,.648,-.84,dark);
 tube(g,.29,.65,-.85,.3,1.23,-.89,.009,metal,12);
 cylinder(g,.055,.07,.08,.3,.69,-.85,dark,24);
 panel(g,.19,.1,.12,.22,1.08,-.61,dark,.019);
 cylinder(g,.032,.036,.022,.22,1.08,-.54,lens,32).rotation.x=Math.PI/2;
 // Single forward barrel; muzzle tip stays at the simulation's (0,.9,.6).
 const turret=new T.Group();turret.position.set(0,.79,.04);g.add(turret);
 cylinder(turret,.115,.14,.065,0,0,0,dark,40);
 panel(turret,.14,.13,.24,0,.11,.05,hull,.02);
 panel(turret,.09,.12,.14,.115,.09,.025,dark,.015);
 const mount=new T.Group();mount.position.set(0,.11,.16);turret.add(mount);
 const barrel=cylinder(mount,.023,.032,.36,0,0,.18,metal,32);barrel.rotation.x=Math.PI/2;
 for(const z of [.08,.17,.26])torus(mount,.033,.008,0,0,z,dark);
 cylinder(mount,.038,.038,.04,0,0,.38,dark,32).rotation.x=Math.PI/2;
 cylinder(mount,.02,.02,.003,0,0,.401,rubber,24).rotation.x=Math.PI/2;
 const flash=new T.Mesh(geometry(undefined,'scout-flash',()=>new T.SphereGeometry(.07,12,8)),light);flash.position.z=.4;flash.visible=false;mount.add(flash);
 g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
 flash.castShadow=false;
 if(software)addBlobShadow(g,1.05,.3);
 g.userData={kind:'scout',vehicle:true,wheels,turret,barrels:[barrel],guns:[{mount,barrel,flash}],flashUntil:0,color:'#708578'};
 return g;
}

// Dedicated six-seat APC. Broad bevels and inset panels survive posterization,
// outlines and bloom without relying on noisy textures or tiny emissive trim.
function transportModel(software=false){
 const g=new T.Group();g.name='transport-apc';
 const armor=material('#657767',.38,.65),edge=material('#a8b49b',.42,.52),dark=material('#26332f',.5,.62),rubber=material('#141b1c',.03,.94),steel=material('#829296',.75,.38),glass=material('#183b49',.55,.24),mark=material('#d4bb76',.22,.65),lamp=material('#ffe1a1',.2,.4,true),red=material('#bd4636',.2,.48,true);
 // Extruded rounded rectangles give genuine multi-segment edge highlights.
 const plate=(parent,w,h,d,x,y,z,mat,b=.06)=>{
  b=Math.min(b,w*.2,h*.2,d*.2);
  const geo=geometry(undefined,`apc-bevel|${w}|${h}|${d}|${b}`,()=>{
   const s=new T.Shape(),a=w/2-b,c=h/2-b,r=Math.min(.1,a*.3,c*.3);
   s.moveTo(-a+r,-c);s.lineTo(a-r,-c);s.quadraticCurveTo(a,-c,a,-c+r);s.lineTo(a,c-r);s.quadraticCurveTo(a,c,a-r,c);s.lineTo(-a+r,c);s.quadraticCurveTo(-a,c,-a,c-r);s.lineTo(-a,-c+r);s.quadraticCurveTo(-a,-c,-a+r,-c);
   const geo=new T.ExtrudeGeometry(s,{depth:d-2*b,steps:1,bevelEnabled:true,bevelSegments:3,bevelSize:b,bevelThickness:b,curveSegments:6});geo.translate(0,0,-d/2+b);return geo;
  });
  const m=new T.Mesh(geo,mat);m.position.set(x,y,z);parent.add(m);return m;
 };
 plate(g,2.04,.35,5.65,0,.58,0,dark,.1);
 plate(g,2.32,.76,5.8,0,1.04,0,armor,.14);
 plate(g,2.06,.88,4.48,0,1.62,-.52,armor,.14);
 const nose=plate(g,2.18,.24,1.18,0,1.43,2.24,edge,.07);nose.rotation.x=.23;
 plate(g,1.96,.13,4.36,0,2.09,-.52,edge,.045);
 // Armored cab glazing: dark gaskets, thick center mullion, raised brows.
 for(const side of [-1,1]){
  const frame=plate(g,.86,.43,.12,side*.5,1.8,1.74,dark,.035);frame.rotation.x=.13;
  const pane=plate(g,.72,.29,.045,side*.5,1.81,1.815,glass,.012);pane.rotation.x=.13;
  plate(g,.92,.085,.2,side*.5,2.04,1.76,armor,.025);
  plate(g,.13,.32,.65,side*1.05,1.79,1.17,dark,.025);
  plate(g,.035,.22,.49,side*1.125,1.79,1.17,glass,.01);
  // Three spaced armor sections define the protected passenger volume.
  for(const z of [-2.12,-.94,.24]){
   plate(g,.15,.63,.98,side*1.07,1.64,z,dark,.035);
   plate(g,.13,.51,.87,side*1.16,1.64,z,edge,.035);
   plate(g,.04,.115,.42,side*1.235,1.76,z,dark,.01);
   for(const dz of [-.32,.32]){const bolt=cylinder(g,.035,.035,.035,side*1.25,1.48,z+dz,steel,12);bolt.rotation.z=Math.PI/2;}
  }
  plate(g,.16,.17,5.45,side*1.18,1.18,0,armor,.035);
  plate(g,.24,.14,1.14,side*1.17,.7,-2.16,dark,.035);
  // Front light recesses and short protective brush bars.
  plate(g,.49,.24,.12,side*.8,1.14,2.93,dark,.035);
  for(const dx of [-.12,.12]){const l=cylinder(g,.073,.073,.045,side*.8+dx,1.15,3.005,lamp,24);l.rotation.x=Math.PI/2;}
  tube(g,side*1.02,.82,3.04,side*1.02,1.31,3.04,.04,steel,12);
  plate(g,.17,.25,.09,side*.98,1.15,-2.96,red,.02);
  plate(g,.055,.19,.55,side*1.25,1.33,1.65,mark,.012);
 }
 plate(g,2.28,.22,.22,0,.8,2.97,dark,.06);
 plate(g,1.14,.3,.08,0,1.09,2.944,dark,.02);
 for(let i=0;i<7;i++)box(g,.085,.22,.035,(i-3)*.145,1.09,2.996,steel);
 // Rear boarding ramp, hydraulic hinges, non-slip steps and grab rails.
 plate(g,1.68,1.16,.12,0,1.44,-2.86,dark,.04);
 plate(g,1.48,1.02,.12,0,1.44,-2.95,armor,.05);
 for(const y of [1.04,1.27,1.5,1.73])plate(g,1.28,.055,.045,0,y,-3.025,edge,.012);
 for(const x of [-.62,.62]){cylinder(g,.075,.075,.29,x,.86,-2.98,steel,24).rotation.z=Math.PI/2;tube(g,x,1.64,-3.04,x,1.93,-3.04,.028,steel,12);}
 plate(g,1.78,.11,.27,0,.68,-2.94,dark,.03);
 // Six high-resolution tires; tread blocks and hubs rotate with existing wheel rig.
 const wheels=[];
 for(const side of [-1,1])for(const z of [-2.14,0,2.14]){
  const wheel=new T.Group();wheel.position.set(side*1.09,.56,z);g.add(wheel);wheels.push(wheel);
  const tireGeo=geometry(undefined,'apc-tire',()=>new T.TorusGeometry(.405,.145,12,48));
  const tire=new T.Mesh(tireGeo,rubber);tire.rotation.y=Math.PI/2;wheel.add(tire);
  cylinder(wheel,.33,.33,.29,0,0,0,rubber,48).rotation.z=Math.PI/2;
  cylinder(wheel,.267,.267,.34,0,0,0,steel,32).rotation.z=Math.PI/2;
  cylinder(wheel,.18,.18,.36,0,0,0,dark,32).rotation.z=Math.PI/2;
  cylinder(wheel,.105,.105,.4,0,0,0,edge,24).rotation.z=Math.PI/2;
  for(let i=0;i<32;i++)for(const row of [-1,1]){const a=i*Math.PI/16+row*.045;const tread=box(wheel,.145,.055,.085,row*.085,Math.cos(a)*.54,Math.sin(a)*.54,rubber);tread.rotation.x=a;tread.rotation.y=row*.2;}
  for(let i=0;i<8;i++){const a=i*Math.PI/4;const bolt=cylinder(wheel,.027,.027,.035,side*.192,Math.cos(a)*.217,Math.sin(a)*.217,edge,12);bolt.rotation.z=Math.PI/2;}
  const arch=new T.Mesh(geometry(undefined,'apc-fender',()=>new T.TorusGeometry(.625,.065,10,40,Math.PI)),armor);arch.rotation.y=Math.PI/2;arch.position.set(side*1.09,.56,z);g.add(arch);
  tube(g,side*.7,.77,z-.24,side*1.05,.56,z,.075,steel,16);
 }
 // Roof escape hatch, cooling louvers, strapped stowage, short communications mast.
 plate(g,1.12,.085,.88,0,2.18,.74,dark,.025);
 plate(g,.96,.075,.74,0,2.24,.74,armor,.025);
 tube(g,-.18,2.3,.73,.18,2.3,.73,.03,steel,12);
 for(const side of [-1,1]){
  plate(g,.39,.075,.81,side*.72,2.19,-2.12,dark,.018);
  for(let i=0;i<6;i++)box(g,.32,.035,.055,side*.72,2.245,-2.43+i*.12,steel);
  plate(g,.32,.25,.67,side*.79,2.26,-.66,armor,.035);
  for(const z of [-.87,-.45])box(g,.34,.027,.07,side*.79,2.397,z,dark);
 }
 cylinder(g,.075,.09,.15,-.84,2.28,-1.4,dark,24);
 tube(g,-.84,2.35,-1.4,-.87,2.82,-1.48,.015,steel,12);
 // Defensive twin gun, not a siege cannon. Preserve turret and flash animation API.
 const turret=new T.Group();turret.name='transport-defensive-turret';turret.position.set(0,2.16,-1.34);g.add(turret);
 cylinder(turret,.52,.55,.13,0,.04,0,dark,48);
 cylinder(turret,.43,.48,.19,0,.16,0,edge,48);
 plate(turret,.94,.27,.7,0,.32,0,armor,.065);
 const barrels=[],guns=[];
 for(const x of [-.31,.31]){
  const mount=new T.Group();mount.position.set(x,.33,.3);turret.add(mount);
  plate(mount,.23,.22,.33,0,0,.03,dark,.04);
  const barrel=cylinder(mount,.058,.073,.83,0,0,.49,steel,32);barrel.rotation.x=Math.PI/2;barrels.push(barrel);
  for(const z of [.18,.32,.72,.91])cylinder(mount,.083,.083,.055,0,0,z,dark,24).rotation.x=Math.PI/2;
  cylinder(mount,.044,.044,.012,0,0,.944,rubber,24).rotation.x=Math.PI/2;
  const flash=new T.Mesh(geometry(undefined,'apc-flash',()=>new T.SphereGeometry(.14,12,8)),lamp);flash.position.set(0,0,.98);flash.visible=false;mount.add(flash);guns.push({mount,barrel,flash});
 }
 plate(turret,.23,.18,.24,0,.52,.1,dark,.03);plate(turret,.14,.085,.025,0,.54,.235,glass,.008);
 g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
 if(software)addBlobShadow(g,3,.32);
 g.userData={kind:'transport',vehicle:true,wheels,turret,barrels,guns,flashUntil:0,color:'#657767'};
 return g;
}

// Merge the stationary meshes of a dedicated WebGL vehicle model into one mesh
// per material, container by container. Animated containers stay intact: wheel
// groups rotate, the turret yaws and gun mounts (with their barrels and muzzle
// flashes) are never merged. Source geometry cached in ModelAssets is left for
// the assets to dispose; temporary clones are released after merging.
function batchVehicleModel(model){
 const mounts=new Set();
 for(const gun of model.userData?.guns||[])if(gun?.mount)mounts.add(gun.mount);
 const merge=(parent)=>{
  const buckets=new Map();
  for(const mesh of [...parent.children])if(mesh.isMesh&&!mounts.has(mesh)){
   mesh.updateMatrix();
   const geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
   geo.applyMatrix4(mesh.matrix);
   if(!buckets.has(mesh.material))buckets.set(mesh.material,[]);
   buckets.get(mesh.material).push(geo);
   parent.remove(mesh);
   if(!currentAssets())mesh.geometry.dispose();
  }
  for(const [mat,parts] of buckets){const merged=mergeGeometries(parts,false);for(const part of parts)part.dispose();if(merged){const mesh=new T.Mesh(merged,mat);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);}}
 };
 const walk=(node)=>{merge(node);for(const child of [...node.children])if(child.isGroup){if(mounts.has(child))continue;walk(child);}};
 walk(model);
 return model;
}
export function vehicleModel(kind='puma',assets,software=false){return withAssets(assets,()=>{
 if(kind==='hornet')return software?hornetModelCompact(true):batchVehicleModel(hornetModelPoly(false));
 if(!software){
  if(kind==='titan')return titanModel(false);
  if(kind==='scout')return batchVehicleModel(scoutModel(false));
  if(kind==='transport')return batchVehicleModel(transportModel(false));
 }
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
  const kit=vehicleKitKind(kind);if(kit)buildVehicleKit(g,kit,matc);
  g.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    if(software)addBlobShadow(g,2.1,.32);
    g.userData={kind,vehicle:true,wheels,turret,barrels,guns,accessories:{spareTire,jerryCan,winch,towHook,splitter},flashUntil:0,color:'#5f6338',...(kit?{kit}:{})};
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
   const key=side<0?'L':'R',role=side<0?'finL':'finR',fin=box(backpack,.055,.34,.18,side*.17,.12,.05,accent);
   fin.name=`wing-fin-${key}`;fin.rotation.x=-.6;fin.rotation.z=side*.22;fin.userData.secondary=role;
   const spar=tag(cylinder(backpack,.014,.014,.24,side*.17,.27,.01,dark,6));
   spar.name=`wing-fin-spar-${key}`;spar.rotation.x=-.6;spar.rotation.z=side*.22;spar.userData.secondary=role;
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
  const mast=cylinder(head,.01,.01,.26,-.14,.2,.01,dark,6);mast.name='wing-sensor-mast';mast.rotation.z=.24;mast.userData.secondary='sensor';
  const bulb=tag(new T.Mesh(geometry(undefined,'wing-sensor-bulb',()=>new T.SphereGeometry(.052,8,6)),accent));
  bulb.name='wing-sensor-bulb';bulb.position.set(-.17,.32,.01);bulb.userData.secondary='sensor';head.add(bulb);
  const dish=tag(new T.Mesh(geometry(undefined,'wing-dish',()=>new T.ConeGeometry(.07,.05,10)),accent));
  dish.name='wing-sensor-dish';dish.position.set(.12,.17,-.05);dish.rotation.x=Math.PI*.46;dish.userData.secondary='sensor';head.add(dish);
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
  const backpack=new T.Group();backpack.name='backpack';backpack.position.set(0,.02,.22);backpack.userData.secondary='pack';chest.add(backpack);
  ball(backpack,.15,dark,10).scale.set(1.15,.95,.55);
  for(const x of [-.075,.075]){const tank=cylinder(backpack,.045,.045,.26,x,.02,.05,color,8);tank.rotation.x=Math.PI/2;}
  const vent=box(backpack,.2,.06,.06,0,.11,-.06,glow);vent.rotation.x=.2;
  const antenna=cylinder(backpack,.012,.012,.34,.12,.16,.05,dark,6);antenna.rotation.z=-.16;antenna.userData.secondary='antenna';
  const head=new T.Group();head.position.y=.34;chest.add(head);
  ball(head,.19,armor,16).scale.set(.96,1.04,.98);
  const visor=ball(head,.14,dark,12);visor.position.set(0,.01,-.09);visor.scale.set(1.02,.46,.6);
  const eye=ball(head,.075,glow,10);eye.position.set(0,.015,-.19);eye.scale.set(1.05,.42,.5);
  // Visor brow and sensor nub give the head a readable helmet silhouette.
  const brow=ball(head,.155,armor,12);brow.position.set(0,.075,-.075);brow.scale.set(1.04,.16,.62);brow.name='visor-brow';
  const nub=ball(head,.028,glow,8);nub.position.set(0,-.045,-.205);nub.name='visor-nub';
 if(id==='chatgpt')ring(head,.17,.018,0,.02,0,glow,Math.PI/2);
 if(id==='claude'){for(const x of [-.2,.2]){const fin=ball(head,.07,color,8);fin.position.set(x,.05,.02);fin.scale.set(.6,1.7,.9);fin.userData.secondary='crest';}const crest=ball(chest,.06,color,8);crest.position.set(0,.16,-.22);crest.scale.set(.5,1.6,.5);crest.userData.secondary='crest';}
 if(id==='grok'){const ant=cylinder(head,.012,.012,.34,0,.28,.02,dark,6);ant.userData.secondary='antenna';const tip=ball(head,.035,glow,8);tip.position.set(.16,.3,.02);tip.userData.secondary='antenna';}
 if(id==='meta'){for(const x of [-.13,.13])ring(chest,.11,.02,x,.05,-.19,glow,0);}
 if(id==='gemini'){for(const x of [-.11,.11]){const star=ball(head,.055,glow,8);star.position.set(x,.01,-.2);}const spine=ball(chest,.05,color,8);spine.position.set(0,.05,-.24);spine.scale.set(.5,2.4,.5);spine.userData.secondary='crest';}
 if(id==='deepseek'){const crest=ball(head,.06,color,8);crest.position.set(0,.2,.02);crest.scale.set(.6,1.8,.8);crest.userData.secondary='crest';}
 if(id==='mistral'){for(let i=0;i<3;i++){const fin=ball(head,.05,color,8);fin.position.set(.08-i*.08,.16+i*.03,0);fin.scale.set(1.4,.5,.7);fin.userData.secondary='crest';}}
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
  // Adaptive graphics-lab budget: the per-target lab stacks are much heavier
  // than the world pass, so a slow machine sheds them (then the whole lab)
  // instead of running at single-digit frames. `_labLevel` is the live level,
  // 0 = full look, 1 = world pass only, 2 = lab bypassed.
  this._labLevel=0;this._labBudget={level:0,slow:0,fast:0,cool:0};this.adaptiveLab=true;
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
   // Per-target lab stacks. `worldCamera` mirrors the live camera for the
   // composer, `botCamera` renders the actor layer, and the lab passes plus
   // offscreen targets are created lazily only while a target is active.
   this.worldCamera=null;this.botCamera=null;this._weaponLab=null;this._weaponTarget=null;this._botLab=null;this._botTarget=null;this._labDisplayTarget=null;this._labEncodePass=null;this._labShadowTarget=null;this._labClearColor=null;
   if(this.renderer.isSoftware===true){this.camera.add(this.hands);}
   else{this.weaponScene=new T.Scene();this.weaponRoot=new T.Group();this.weaponScene.add(this.weaponRoot);this.weaponRoot.add(this.hands);this.weaponCamera=new T.PerspectiveCamera(this.weaponFov,1,.02,4);this.weaponScene.add(new T.HemisphereLight('#cfe9ff','#20262c',2.2));const weaponKey=new T.DirectionalLight('#ffffff',2.6);weaponKey.position.set(-2,4,3);this.weaponScene.add(weaponKey);}
   this._enableBotLayers();
   this.scene.add(this.camera);this.currentWeapon=-1;this._weaponCache=new Map();this.aim=false;this.lowHealth=false;this.cameraShake=new CameraShake();this.muzzleLights=null;this.lowHealthOverlay=null;this.railPool=null;this.deathPool=null;this.deathContext=new Map();this.payloadModel=null;this.decalPool=null;this.ripplePool=null;this.contactShadows=null;this.weatherAdd=null;this._weatherSplashSerial=0;this.ambientFx=null;this.ambientPool=null;this.ambientConfig=null;this.ambientAnchors=[];this.scatterWind=[];this.killcamEnabled=true;this._killcam=null;this.hitPool=null;this.hitFlinch=new Map();this.followMarkers=null;
   // Ability/harness visual effects: the seven harness actives, the nine
   // snapshot-driven signature verbs and the placed-rope cables. Self-contained
   // presentation-only pools; `setMatch` resets them and `dispose` releases
   // every geometry/material.
   this.abilityVfx=createAbilityVfx({quality:()=>this._quality(),reduced:()=>this.reduced(),wingColor:id=>this.actorModels?.get(id)?.userData?.wingColor??null});
   this.abilityVfx.attach(this.scene);
   this._lightning=[];this._lightningAt=0;this._flash=0;this._wetSheenApplied=0;this.preview=null;this.showcaseExpected=false;if(this.renderer.isSoftware!==true){this.muzzleLights=new MuzzleLightPool(this.scene,muzzleLightCount(this.qualitySettings?.tier??0));this.lowHealthOverlay=new LowHealthOverlay(this.camera);if(typeof document!=='undefined')this.railPool=new RailBeamPool(this.scene,6);this.decalPool=new DecalPool(this.scene,18);const rim=new T.DirectionalLight('#7fd8ff',.55);rim.position.set(-7,6,-9);rim.userData.rimLight=true;this.scene.add(rim);}this.menu=this.makeMenu();this.cinema=false;this.director=null;this._cameraOwner='auto';this._freeCam=false;this._directorLock=false;this.manualFollowId=null;this.freePose={x:0,y:6,z:0,yaw:0,pitch:0};this.freeSpeed=FREE_CAM_DEFAULT_SPEED;this.freeBoost=FREE_CAM_BOOST;this._freeVel=null;this._freeExit=null;this._freeExitPose=null;this._lastMode=null;this.showcaseState=null;this.previewRect=null;this.raycaster=new T.Raycaster();this._occClear=0;this.resize();}
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
        // Shadow level + map size follow the display option first, then the
        // quality tier's own shadow budget. Changing shadow.mapSize alone does
        // not resize an already-created render target in this three revision:
        // dispose it so three allocates the new size on the next shadow pass,
        // and request exactly one shadow refresh.
        this._applyShadows();
        if(this.renderer?.setScreenArea)this.renderer.setScreenArea(q.tier===0?.12:q.tier===1?.09:.06);
        // Image-based ambient/reflections scale with the tier: this is the
        // cheapest lever on how metallic surfaces read, and the PMREM texture is
        // shared, so no extra GPU memory is allocated.
        if(this.scene&&Number.isFinite(q.environment))this.scene.environmentIntensity=q.environment;
        this._applyEffectsQuality();
        // Muzzle-light budget follows the tier (2/3/4). The pool is fixed-size,
        // so a tier change releases the old lights and builds the new budget.
        if(this.scene&&this.muzzleLights){const count=muzzleLightCount(q.tier);if(this.muzzleLights.lights.length!==count){this.muzzleLights.dispose();this.muzzleLights=new MuzzleLightPool(this.scene,count);}}
        // The CPU renderer gets a hard per-frame triangle ceiling taken from the
        // active tier; WebGL lowers real geometry detail through _applyModelDetail.
        if(software&&this.renderer.setTriangleBudget)this.renderer.setTriangleBudget(frameTriangleBudget(this.quality,{software:true}));
        this._applyPostQuality();
        this._applyModelDetail();
       }
       // Shadow level from the display option: `off` disables casting entirely,
       // `low` clamps the map to the smaller tier's size, `high` uses the active
       // quality tier's map. Live-updatable — setDisplay calls this through
       // _applyQuality; a map that only changes size is reallocated on the next
       // shadow pass because three does not resize an existing target.
       _applyShadows(){
        const software=this.renderer?.isSoftware===true,level=['high','low','off'].includes(this.display?.shadows)?this.display.shadows:'high';
        const enabled=!software&&level!=='off';
        if(this.sun)this.sun.castShadow=enabled;
        if(this.renderer?.shadowMap)this.renderer.shadowMap.enabled=enabled;
        if(!enabled){this._shadowMapSize=undefined;return false;}
        const tierSize=Number(this.qualitySettings?.shadowMap)||2048,size=level==='low'?Math.min(tierSize,1024):tierSize;
        if(this._shadowMapSize!==size){
         this._shadowMapSize=size;
         if(this.sun?.shadow){if(this.sun.shadow.map){this.sun.shadow.map.dispose?.();this.sun.shadow.map=null;}this.sun.shadow.mapSize.set(size,size);}
         if(this.renderer?.shadowMap)this.renderer.shadowMap.needsUpdate=true;
        }
        return true;
       }
       // The separate effects-quality control scales particle/decal budgets on top
       // of the active tier, independent of the overall quality tier.
       _effectsScaleValue(level=this.display?.effectsQuality){return level==='low'?.4:level==='medium'?.7:level==='high'?1.15:1;}
       _applyEffectsQuality(){
        const s=this._effectsScaleValue(),q=this.qualitySettings||{};
        this._effectsScale=s;
        // Combat particle budgets fold the tier and the effects slider together.
        // The default `auto` slider keeps s=1, so high-tier output is unchanged.
        this._combatParticleScale=Math.max(.2,Math.min(2,(q.particles??1)*s));
        if(this.ambientFx)this.ambientFx.moteCap=Math.max(1,Math.round((q.ambientMotes??3)*s));
        // The precipitation cap follows the preset's own particle budget, so a
        // heavier storm reads denser than an overcast drizzle on the same tier.
        if(this.weatherFx)this.weatherFx.cap=weatherParticleCap(this.weatherState?.preset,q,s,44);
       }
       // Shared combat-particle multiplier for impact sparks, death bursts and
       // shield shatter. Falls back to the live tier when a partially
       // constructed view never ran _applyEffectsQuality.
       _particleScale(){
        if(Number.isFinite(this._combatParticleScale))return this._combatParticleScale;
        const q=this._quality()||{};
        return Math.max(.2,Math.min(2,(q.particles??1)*(Number.isFinite(this._effectsScale)?this._effectsScale:1)));
       }
       _impactSparkCount(base=4){return Math.max(1,Math.round(base*this._particleScale()));}
       // Enable/disable whole post passes and set the independent bloom budget
       // without touching the world render resolution.
       _applyPostQuality(){
        // Called from _onQualityChange, which also runs during construction
        // before the scene/camera exist; skip until the render graph is ready.
        if(!this.composer&&(!this.scene||!this.camera))return;
        const q=this.qualitySettings||{};
        this._syncPost();
        if(this.bloomPass){const tune=bloomTuning(q.tier);this.bloomPass.strength=Number(this.display?.bloom)*Number(q.bloom);this.bloomPass.threshold=tune.threshold;this.bloomPass.radius=tune.radius;}
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
        const dt=Number.isFinite(delta)?delta:0;
        if(dt<=0||dt>.25)return this.quality;
        let sampled=false;
        const f=this._fps??(this._fps={frames:0,elapsed:0,value:60});f.frames++;f.elapsed+=dt;if(f.elapsed>=.5){f.value=f.frames/f.elapsed;f.frames=0;f.elapsed=0;sampled=true;}
        pushFrameTime(this._frameWindow,dt*1000);
        // Sorting 120 samples every frame adds allocation/sort work to the
        // thing being measured. HUD percentiles need only the 2 Hz sample rate.
        if(this.perf){this.perf.lastFrameMs=dt*1000;if(sampled){const [median,p95]=framePercentiles(this._frameWindow);this.perf.medianFrameMs=median;this.perf.p95FrameMs=p95;}}
        if(this._qualityOverride!=null)return this.quality;
        const cap=Number(this.display?.fpsCap)||0,capMs=cap>0?1000/cap:0;
        if(sampled&&this.dynamicResolution!==false){const d=this._drs??(this._drs={scale:1,cool:0});const frameMs=this._fps?.value>0?1000/this._fps.value:0;const next=nextDynamicScale(d,{frameMs,elapsedMs:500},{slowMs:Math.max(1000/48,capMs+2.5),fastMs:Math.max(1000/55,capMs+1.5)});const changed=next.scale!==d.scale;this._drs=next;if(changed)this.resize();}
        const software=this.renderer?.isSoftware===true,reduced=this.reduced()===true,ceiling=normalizeQuality(undefined,{software,reduced});
        const state=this._qualityState??(this._qualityState={level:null,bad:0,good:0,cool:0});
        if(!QUALITY_LEVELS.includes(state.level))state.level=this.quality??ceiling;
        const next=nextQualityState(state,dt*1000,{ceiling,software,minFps:1000/Math.max(1000/45,capMs+3),maxFps:1000/Math.max(1000/58,capMs+1.5)});
        state.level=next.level;state.bad=next.bad;state.good=next.good;state.cool=next.cool;
        if(next.changed&&next.level!==this.quality){this.quality=next.level;this.qualitySettings=qualitySettings(next.level,{software,reduced});this._onQualityChange();}
        return this.quality;
       }
        setDisplay(prefs){if(prefs&&typeof prefs==='object'&&'quality' in prefs)this._qualityOverride=normalizeQualityOverride(prefs.quality);const display=normalizeDisplay(prefs),scaleChanged=display.resolutionScale!==this.display?.resolutionScale||display.resolutionCap!==this.display?.resolutionCap;this.display=display;this.camera.fov=display.fov;this.camera.updateProjectionMatrix();this.weaponFov=Math.max(45,Number(display.fov)||this.weaponFov||70);if(this.weaponCamera)this.weaponCamera.fov=this.weaponFov;this.showWeapon=display.showWeapon;if('toneMappingExposure' in this.renderer)this.renderer.toneMappingExposure=Number(display.exposure)||1.15;this._applyQuality();this._applyShadows();this._applyEffectsQuality?.();if(scaleChanged)this.resize();this._syncPost?.();this._syncLabTargets?.();}
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
     if(!rig||!rig.model||rig.pivot?.visible===false||!rect||rect.width<12||rect.height<12)return false;
     if(this.renderer?.isSoftware===true)return false;
     if(rig.camera?.aspect!==rect.width/rect.height)rig.resize(rect.width,rect.height);
     return this._renderSceneInto(this.renderer,rect,rig.scene,rig.camera);
    }
    // Scissor a scene into a CSS-pixel rect on the shared renderer, restoring the
    // full viewport afterwards. Used by both the character and weapon previews.
    _renderSceneInto(renderer,rect,scene,camera){
     const w=this.width,h=this.height;if(!(w>0&&h>0))return false;
     const x=Math.round(rect.left),y=Math.round(h-rect.bottom),vw=Math.max(1,Math.round(rect.width)),vh=Math.max(1,Math.round(rect.height));
     if(!Number.isFinite(x+y+vw+vh)||x>=w||y>=h||x+vw<=0||y+vh<=0)return false;
     const prevAuto=renderer.autoClear;
     renderer.setScissorTest(true);renderer.setViewport(x,y,vw,vh);renderer.setScissor(x,y,vw,vh);renderer.autoClear=true;
     try{renderer.render(scene,camera);}
     finally{renderer.setScissorTest(false);renderer.setViewport(0,0,w,h);renderer.setScissor(0,0,w,h);renderer.autoClear=prevAuto;}
     return true;
    }
    cinemaLook(dy,dp){this.director?.look?.(dy,dp);}
    resize(){const w=Math.max(1,this.renderer.domElement.clientWidth),h=Math.max(1,this.renderer.domElement.clientHeight),ratio=budgetedRatio({width:w,height:h,dpr:window.devicePixelRatio,scale:this.display?.resolutionScale??1,cap:this.display?.resolutionCap??'auto',software:this.renderer.isSoftware===true,dynamic:this._drs?.scale??1});
     // Display/quality/lab setters synchronize their own resources. A stable
     // viewport must not reconfigure every pass and recheck every target each
     // frame. OS motion preference changes still invalidate post eligibility.
     const reduced=this.reduced(),motionChanged=this._postReduced!==reduced;this._postReduced=reduced;
     if(this.width===w&&this.height===h&&this.pixelRatio===ratio){if(motionChanged){this._syncPost?.();this._syncLabTargets?.();}return;}
     if(this.pixelRatio!==ratio)this.renderer.setPixelRatio(ratio);
     // Keep even tiny/hidden canvases at least one backing pixel without changing CSS size.
     this.renderer.setSize(Math.max(w,1/ratio),Math.max(h,1/ratio),false);this.width=w;this.height=h;this.pixelRatio=ratio;
     // Report the real drawing-buffer dimensions rather than assuming a monitor
     // resolution; a 100% world render is capped by the resolution budget (resolution.mjs).
     if(this.perf){const dom=this.renderer.domElement||{},dpr=window.devicePixelRatio;this.perf.viewport={cssWidth:w,cssHeight:h,devicePixelRatio:Number.isFinite(dpr)?dpr:1,bufferWidth:dom.width??Math.round(w*ratio),bufferHeight:dom.height??Math.round(h*ratio),scale:ratio};}
     this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.menu.camera.aspect=w/h;this.menu.camera.updateProjectionMatrix();if(this.weaponCamera){this.weaponCamera.aspect=w/h;this.weaponCamera.updateProjectionMatrix();}this._syncPost?.();this._syncLabTargets?.();}
     setGraphicsLab(prefs){this.graphicsLab=normalizeGraphicsLab(prefs);this._labBudget={level:0,slow:0,fast:0,cool:0};this._labLevel=0;this._syncPost();this._syncLabTargets();}
     // Benchmark and screenshot harnesses pin the full look so runs stay
     // comparable; turning adaptivity back on resets the governor.
     setAdaptiveLab(on){this.adaptiveLab=on!==false;this._labBudget={level:this.adaptiveLab?(this._labLevel??0):0,slow:0,fast:0,cool:0};if(!this.adaptiveLab&&this._labLevel!==0)this._setLabLevel(0);return this.adaptiveLab;}
     _setLabLevel(level){
      const next=Math.max(0,Math.min(2,Math.round(Number(level)||0)));
      if(next===this._labLevel)return false;
      this._labLevel=next;
      this._syncPost();
      this._syncLabTargets();
      return true;
     }
     // Fed by drawn frames only (the frame cap returns before this runs). Hitches
     // and tab-resume gaps are ignored so one stall cannot scale the look down.
     _sampleLabBudget(delta){
      if(!Number.isFinite(this._labLevel))this._labLevel=0;
      if(this.adaptiveLab!==true||this.graphicsLab?.enabled!==true||this.renderer?.isSoftware===true)return this._labLevel;
      const dt=Number.isFinite(delta)?delta:0;
      if(dt<=0||dt>.25)return this._labLevel;
      // A deliberate frame cap raises the expected frame time: a 30 fps cap is
      // not slowness, so both thresholds move with the cap.
      const capMs=(Number(this.display?.fpsCap)||0)>0?1000/Number(this.display.fpsCap):0;
      const next=nextLabBudget(this._labBudget,dt*1000,{slowMs:Math.max(19,capMs+2.5),recoverMs:Math.max(13.5,capMs+1.5)});
      this._labBudget=next;
      if(next.changed)this._setLabLevel(next.level);
      return this._labLevel;
     }
     _syncPost(){
      const eligible=this.renderer instanceof T.WebGLRenderer,q=this.qualitySettings||this._quality();
      this._postError=null;
      const base=postStage({eligible,reduced:this.reduced(),postFx:this.display?.postFx});
      const lab=eligible&&this.graphicsLab?.enabled===true&&this._labLevel<2;
      const bloomStrength=base?Number(this.display?.bloom)*Number(q.bloom):0;
      const finish=this._finishAmounts(q,base);
      const want=base||lab;
      if(!want){if(this.composer){disposeComposer(this.composer);this.composer=null;this.bloomPass=null;this.vignettePass=null;this.aaPass=null;this.graphicsLabPass=null;this.finishPass=null;this._postKey=null;}this._disposeLabTargets();this._postW=0;this._postH=0;this._postRatio=0;return;}
     // A zero-strength bloom used to leave its expensive processing running. The
     // pass is now omitted entirely, and the vignette/FXAA passes follow the
     // quality tier, so the composed path only contains passes that do work.
      const key=`${bloomStrength>0?1:0}|${base&&q.vignette!==false?1:0}|${base&&q.fxaa!==false?1:0}|lab:${lab?1:0}`;
      if(this.composer&&this._postKey!==key){disposeComposer(this.composer);this.composer=null;this.bloomPass=null;this.vignettePass=null;this.aaPass=null;this.graphicsLabPass=null;this.finishPass=null;this._disposeLabTargets();}
     if(!this.composer){try{
      // Low tier drops FXAA, so recover edge AA with 2 MSAA samples on the
      // composer targets when the context supports multisampled targets. The lab
      // stacks keep plain targets: they attach sampleable depth textures.
      const caps=this.renderer?.capabilities,msaa=base&&q.fxaa===false&&lab!==true&&caps?.isWebGL2===true&&Number(caps?.maxSamples)>=2?2:0;
      const target=msaa?new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,samples:msaa}):undefined;
      const composer=new EffectComposer(this.renderer,target),worldCamera=this.worldCamera??(this.worldCamera=this._makeMirrorCamera());composer.addPass(new RenderPass(this.scene,worldCamera));
      if(bloomStrength>0){const tune=bloomTuning(q.tier);this.bloomPass=new UnrealBloomPass(new T.Vector2(1,1),bloomStrength,tune.radius,tune.threshold);composer.addPass(this.bloomPass);}
       if(base&&q.vignette!==false){const vignette=new ShaderPass(VignetteShader);vignette.uniforms.offset.value=1.05;vignette.uniforms.darkness.value=.92;this._disablePassDepth(vignette);composer.addPass(vignette);this.vignettePass=vignette;}
      const output=new OutputPass();this._disablePassDepth(output);composer.addPass(output);
      // FXAA follows OutputPass (sRGB). The default framebuffer still requests
      // MSAA for the direct path and the post-composer weapon pass, so this pass
      // only covers the composer's non-MSAA render targets.
       if(base&&q.fxaa!==false){const aa=new ShaderPass(FXAAShader);aa.name='fxaa';this._disablePassDepth(aa);composer.addPass(aa);this.aaPass=aa;}
       if(lab){this.graphicsLabPass=new GraphicsLabPass();this._disablePassDepth(this.graphicsLabPass);composer.addPass(this.graphicsLabPass);}
       // The finish pass is the display-space tail: it runs last (after the lab
       // when the lab is on) so its dither lands on the final 8-bit values.
       this.finishPass=new FinishPass();this._disablePassDepth(this.finishPass);composer.addPass(this.finishPass);
      if(lab)this._attachComposerDepth(composer);
      this.composer=composer;this._postKey=key;this._postW=0;this._postH=0;this._postRatio=0;}catch(error){this._postError=String(error?.message||error);this.composer=null;this._disposeLabTargets();return;}}
     if(this.bloomPass){const tune=bloomTuning(q.tier);this.bloomPass.strength=bloomStrength;this.bloomPass.threshold=tune.threshold;this.bloomPass.radius=tune.radius;}
      const w=Math.max(1,this.renderer.domElement.clientWidth),h=Math.max(1,this.renderer.domElement.clientHeight),ratio=this.pixelRatio??1;
      if(this.graphicsLabPass)this.graphicsLabPass.configure(this.graphicsLab,w,h);
      if(this.finishPass)this.finishPass.configure(finish,w,h);
     if(this._postW!==w||this._postH!==h||this._postRatio!==ratio){
      applyComposerSize(this.composer,w,h,ratio);
      if(lab)this._attachComposerDepth(this.composer);
      // Independent bloom budget applied after composer resizing, so a resize can
      // never overwrite the cap with the full-resolution target.
      if(this.bloomPass){const budget=bloomResolution(w,h,{scale:q.bloomScale??.5,maxDim:q.bloomMax??1024});this.bloomPass.setSize?.(budget.width,budget.height);}
      if(this.aaPass)this.aaPass.uniforms.resolution.value.set(1/(w*ratio),1/(h*ratio));
      this._postW=w;this._postH=h;this._postRatio=ratio;
     }
    }
    // Quality owns the finish amounts; `setPolish` can override them for an A/B
    // capture (tests and the developer harness), never for gameplay settings.
    _finishAmounts(q,base){
     const dither=Number.isFinite(this._polish?.dither)?this._polish.dither:(base?Number(q?.dither??1):1);
     const sharpen=Number.isFinite(this._polish?.sharpen)?this._polish.sharpen:(base?Number(q?.sharpen??0):0);
     return {dither,sharpen};
    }
    setPolish(polish){
     if(polish===null||polish===undefined){this._polish=null;}
     else this._polish={...(this._polish||{}),...(Number.isFinite(polish.dither)?{dither:polish.dither}:{}),...(Number.isFinite(polish.sharpen)?{sharpen:polish.sharpen}:{})};
     this._syncPost();
     return this._finishAmounts(this.qualitySettings||this._quality(),postStage({eligible:this.renderer instanceof T.WebGLRenderer,reduced:this.reduced(),postFx:this.display?.postFx}));
    }
    // ---- Per-target graphics-lab stacks -------------------------------------
    // Actor models render on their own layer; the live camera and the shadow
    // camera keep it enabled, while the composer's world camera drops it only on
    // frames where a bot stack is active.
    _enableBotLayers(){
     if(this.camera?.layers)this.camera.layers.enable(BOT_LAYER);
     if(this.sun?.shadow?.camera?.layers)this.sun.shadow.camera.layers.enable(BOT_LAYER);
    }
    // Actor models join the scene on the bot layer only. The camera-occlusion
    // raycast operates on `worldGroup`, and every other consumer finds actors
    // through `actorModels`, so nothing else depends on actor layer 0.
    _addActorModel(model){
     model?.traverse?.(node=>node.layers?.set(BOT_LAYER));
     this._ensureCarryBanner(model);
     this.scene?.add(model);
     return model;
    }
    // CTF carrier readability: a small team-tinted banner parented to the actor
    // model and shown only while the snapshot says the actor carries a flag. It
    // is built once per model from generated geometry only and disposed with the
    // model by the shared disposeObject pass.
    _ensureCarryBanner(model){
     const data=model?.userData;
     if(!data||!model.add)return null;
     if(data.carryBanner)return data.carryBanner;
     const group=new T.Group();group.name='carry-banner';
     const material=new T.MeshBasicMaterial({color:'#fff4dc',transparent:true,opacity:.92,depthWrite:false});
     const pole=new T.Mesh(new T.CylinderGeometry(.014,.014,.46,5),material);pole.position.y=.23;
     const banner=new T.Mesh(new T.BoxGeometry(.34,.22,.02),material);banner.position.set(.19,.3,0);
     group.add(pole,banner);
     group.position.set(.4,1.26,.06);group.rotation.y=-.35;group.visible=false;group.renderOrder=4;
     group.traverse(node=>{node.layers?.set(BOT_LAYER);node.userData.objective=true;node.userData.noCameraOcclusion=true;});
     group.userData.carryBanner=true;group.userData.material=material;
     data.carryBanner=group;
     model.add(group);
     return group;
    }
    // Per-frame carrier pass. The authoritative signal is `actor.carryingFlag`;
    // the flag snapshots' carrier ids are the cross-check, so a dropped or
    // returned flag clears the banner on the same frame. Banners on models that
    // are not carrying (or are hidden) stay invisible.
    _syncCarryBanners(match){
     const models=this.actorModels;
     if(!models?.size)return 0;
     const carriers=new Set();
     for(const actor of match?.actors||[]){
      if(!actor||actor.id===undefined||actor.carryingFlag!==true)continue;
      carriers.add(actor.id);
     }
     const flags=match?.flags,rows=Array.isArray(flags)?flags:flags&&typeof flags==='object'?Object.values(flags):[];
     for(const flag of rows){
      if(!flag)continue;
      const carrier=flag.carrier??flag.carrierId??flag.carriedBy;
      if(carrier===null||carrier===undefined)continue;
      carriers.add(Number.isFinite(Number(carrier))?Number(carrier):carrier);
     }
     const arena=match?.arena||MAPS.find(map=>map.id===match?.mapId)||MAPS[0];
     let shown=0;
     for(const [id,model] of models){
      const carrying=carriers.has(id),banner=carrying?this._ensureCarryBanner(model):model?.userData?.carryBanner;
      if(!banner)continue;
      banner.visible=carrying&&model.visible!==false;
      if(!banner.visible)continue;
      shown++;
      const actor=(match?.actors||[]).find(entry=>entry?.id===id),color=this.objectiveColor(actor?.team,arena),material=banner.userData.material;
      if(material?.color)material.color.set(color);
     }
     return shown;
    }
    _makeMirrorCamera(){
     const source=this.camera,camera=new T.PerspectiveCamera(source?.fov??82,source?.aspect??1,source?.near??.08,source?.far??220);
     camera.rotation.order='YXZ';camera.layers.enable(BOT_LAYER);
     return camera;
    }
    // Mirror the live presentation camera onto the camera the world composer
    // owns. Copying the projection matrix (not just fov/aspect) keeps custom
    // zooms exact, and the live camera itself is never touched.
    _syncWorldCamera(botsActive){
     const source=this.camera,world=this.worldCamera??(this.worldCamera=this._makeMirrorCamera());
     if(!source)return world;
     world.position.copy(source.position);world.quaternion.copy(source.quaternion);
     if(source.scale)world.scale.copy(source.scale);
     if(Number.isFinite(source.fov))world.fov=source.fov;
     if(Number.isFinite(source.aspect))world.aspect=source.aspect;
     if(Number.isFinite(source.near))world.near=source.near;
     if(Number.isFinite(source.far))world.far=source.far;
     if(Number.isFinite(source.zoom))world.zoom=source.zoom;
     if(Number.isFinite(source.filmOffset))world.filmOffset=source.filmOffset;
     world.updateMatrixWorld(true);
     if(source.projectionMatrix)world.projectionMatrix.copy(source.projectionMatrix);
     if(source.projectionMatrixInverse)world.projectionMatrixInverse.copy(source.projectionMatrixInverse);
     if(botsActive)world.layers.disable(BOT_LAYER);else world.layers.enable(BOT_LAYER);
     return world;
    }
    // three r185 culls shadow casters against the *render camera's* layers, so a
    // world camera that excludes BOT_LAYER would also drop bot shadows from the
    // map even though `sun.shadow.camera` includes the layer. On a scheduled
    // refresh, rebuild the map once through the live camera (every caster layer)
    // into a 1x1 scratch target, then let the culled world pass reuse it.
    // Auto-update maps refresh during the world pass and need no detour.
    _refreshBotShadowCasters(){
     const shadowMap=this.renderer?.shadowMap;
     if(!shadowMap||shadowMap.enabled===false||shadowMap.autoUpdate!==false||shadowMap.needsUpdate!==true)return false;
     const target=this._labShadowTarget??(this._labShadowTarget=new T.WebGLRenderTarget(1,1,{format:T.RGBAFormat,depthBuffer:true}));
     const previousAuto=this.renderer.autoClear,previousTarget=this.renderer.getRenderTarget();
     this.renderer.autoClear=true;
     try{this.renderer.setRenderTarget(target);this.renderer.render(this.scene,this.camera);}
     finally{this.renderer.setRenderTarget(previousTarget);this.renderer.autoClear=previousAuto;}
     return true;
    }
    // Composer passes that only read a full-screen texture must never clear or
    // write depth: the scene pass's depth texture is sampled by the bot
    // composite, and a later quad writing into the same ping-pong buffer would
    // otherwise clobber it.
    _disablePassDepth(pass){const material=pass?.material;if(material){material.depthTest=false;material.depthWrite=false;}return pass;}
    // Both EffectComposer ping-pong targets need a sampleable depth texture: the
    // scene pass renders into whichever buffer is the read buffer at frame
    // start. three resizes the attached texture from the render target on the
    // next bind (WebGLTextures.setupDepthTexture), and this sync keeps the image
    // size correct immediately after a composer resize.
    _attachComposerDepth(composer){
     if(!composer)return;
     for(const target of [composer.renderTarget1,composer.renderTarget2]){
      if(!target)continue;
      if(!target.depthTexture){const depth=new T.DepthTexture(target.width,target.height);depth.name='GraphicsLab.worldDepth';target.depthTexture=depth;}
      const depth=target.depthTexture;
      if(depth.image.width!==target.width||depth.image.height!==target.height){depth.image.width=target.width;depth.image.height=target.height;depth.needsUpdate=true;}
     }
    }
    _targetState(name){return this.graphicsLab?.targets?.[name]??null;}
    // A per-target stack only runs while the lab as a whole is on; the target's
    // own predicate owns its mix/effect checks. The adaptive budget sheds the
    // per-target stacks first (level 1) and the remaining world pass last
    // (level 2), so a slow machine keeps a coherent, cheaper version of the look.
    _targetActive(target,name){
     if(this._labLevel>=2)return false;
     if(this._labLevel>=1&&(name==='weapon'||name==='bots'))return false;
     return this.graphicsLab?.enabled===true&&this.graphicsLab?.bypass!==true&&graphicsLabTargetActive(target)===true;
    }
    _labEligible(){return this.renderer?.isSoftware!==true&&this.renderer?.isWebGLRenderer===true;}
    // Match applyComposerSize exactly: CSS size rounded, then scaled by the pixel
    // ratio, fractional buffer included, so the bot depth lines up pixel-for-pixel
    // with the composer's scene depth.
    _labBufferSize(){
     const ratio=Number(this.pixelRatio)>0?Number(this.pixelRatio):1;
     const width=Math.max(1,Math.round(Number(this.width)>0?Number(this.width):1)),height=Math.max(1,Math.round(Number(this.height)>0?Number(this.height):1));
     return {width:width*ratio,height:height*ratio};
    }
    // The styled layer targets (bot/weapon source, encode destination) render at
    // half the display buffer. The fused lab shader is graphic, so patterns stay
    // the same CSS size and only edge crispness softens, while the offscreen
    // render, encode and composite all touch a quarter of the pixels. The pass
    // itself still configures with the full size so pixel/hex/hatch math is
    // unchanged.
    _labTargetSize(){
     const size=this._labBufferSize();
     return {width:Math.max(1,Math.round(size.width*.5)),height:Math.max(1,Math.round(size.height*.5))};
    }
    _resizeRenderTarget(target,width,height){
     if(!target)return target;
     if(target.width!==width||target.height!==height)target.setSize(width,height);
     const depth=target.depthTexture;
     if(depth&&(depth.image.width!==width||depth.image.height!==height)){depth.image.width=width;depth.image.height=height;depth.needsUpdate=true;}
     return target;
    }
    // Lazy per-target resources: nothing is allocated while a target is off, and
    // every path that can drop the composer or resize the canvas funnels here.
    _syncLabTargets(){
     const eligible=this._labEligible(),composer=!!this.composer;
     const bots=eligible&&composer&&this._targetActive(this._targetState('bots'),'bots');
     const weapon=eligible&&composer&&this._targetActive(this._targetState('weapon'),'weapon');
     const size=bots||weapon?this._labTargetSize():null;
     if(size){
      if(!this._labDisplayTarget)this._labDisplayTarget=new T.WebGLRenderTarget(size.width,size.height,{format:T.RGBAFormat,depthBuffer:false});
      else this._resizeRenderTarget(this._labDisplayTarget,size.width,size.height);
     }
     if(bots){
      if(!this._botLab)this._botLab=new GraphicsLabPass();
      if(!this._botTarget)this._botTarget=new T.WebGLRenderTarget(size.width,size.height,{format:T.RGBAFormat,depthBuffer:true,depthTexture:new T.DepthTexture(size.width,size.height)});
      else this._resizeRenderTarget(this._botTarget,size.width,size.height);
     }else{
      try{this._botLab?.dispose?.();}catch{}
      try{this._botTarget?.dispose?.();}catch{}
      try{this._labShadowTarget?.dispose?.();}catch{}
      this._botLab=null;this._botTarget=null;this._labShadowTarget=null;
     }
     if(weapon){
      if(!this._weaponLab)this._weaponLab=new GraphicsLabPass();
      if(!this._weaponTarget)this._weaponTarget=new T.WebGLRenderTarget(size.width,size.height,{format:T.RGBAFormat,depthBuffer:true});
      else this._resizeRenderTarget(this._weaponTarget,size.width,size.height);
     }else{
      try{this._weaponLab?.dispose?.();}catch{}
      try{this._weaponTarget?.dispose?.();}catch{}
      this._weaponLab=null;this._weaponTarget=null;
     }
     if(!bots&&!weapon){try{this._labDisplayTarget?.dispose?.();}catch{}this._labDisplayTarget=null;}
    }
    _disposeLabTargets(){
     for(const pass of [this._weaponLab,this._botLab,this._labEncodePass])try{pass?.dispose?.();}catch{}
     for(const target of [this._weaponTarget,this._botTarget,this._labDisplayTarget,this._labShadowTarget])try{target?.dispose?.();}catch{}
     this._weaponLab=null;this._botLab=null;this._labEncodePass=null;
     this._weaponTarget=null;this._botTarget=null;this._labDisplayTarget=null;this._labShadowTarget=null;
    }
    // An offscreen layer render is linear; the fused lab pass is display-referred
    // like the world output, so run the renderer's tone mapping and color-space
    // transform into a scratch target first. OutputShader preserves alpha, so
    // keepAlpha composites are unaffected.
    _encodeLabSource(source,display){
     if(!source||!display)return false;
     const pass=this._labEncodePass??(this._labEncodePass=new OutputPass());
     pass.renderToScreen=false;
     pass.render(this.renderer,display,source);
     return true;
    }
    // One full-screen pass draws the styled layer onto the presented frame with
    // normal alpha blending; the shader itself handles the depth rejection.
    _compositeLab(lab,state,source,{keepAlpha=true,depthTest=false,worldDepth=null,botDepth=null}={}){
     if(!lab||!source)return false;
     const material=lab.material;
     if(material){
      if(material.transparent!==true){material.transparent=true;material.needsUpdate=true;}
      material.blending=T.NormalBlending;material.depthTest=false;material.depthWrite=false;material.toneMapped=false;
     }
     const size=this._labBufferSize();
     lab.configure(state,size.width,size.height,{active:true,keepAlpha,depthTest,worldDepth,botDepth});
     // FullScreenQuad.render() goes through renderer.render(), which would clear
     // the presented frame before blending unless autoClear is off.
     const previousAuto=this.renderer.autoClear;
     this.renderer.autoClear=false;
     try{lab.renderToScreen=true;lab.render(this.renderer,null,source);}
     finally{this.renderer.autoClear=previousAuto;}
     return true;
    }
    // Bot stack: only the actor layer lands on transparent pixels (the world
    // background is parked for the render), then the composite discards pixels
    // the world depth already covers.
    _renderBotLayer(worldTarget){
     const lab=this._botLab,target=this._botTarget,display=this._labDisplayTarget,renderer=this.renderer,scene=this.scene,camera=this.camera;
     if(!lab||!target||!display||!scene||!camera)return false;
     const botCamera=this.botCamera??(this.botCamera=this._makeMirrorCamera());
     botCamera.layers.set(BOT_LAYER);
     botCamera.position.copy(camera.position);botCamera.quaternion.copy(camera.quaternion);
     if(camera.scale)botCamera.scale.copy(camera.scale);
     if(Number.isFinite(camera.fov))botCamera.fov=camera.fov;
     if(Number.isFinite(camera.aspect))botCamera.aspect=camera.aspect;
     if(Number.isFinite(camera.near))botCamera.near=camera.near;
     if(Number.isFinite(camera.far))botCamera.far=camera.far;
     if(Number.isFinite(camera.zoom))botCamera.zoom=camera.zoom;
     if(Number.isFinite(camera.filmOffset))botCamera.filmOffset=camera.filmOffset;
     botCamera.updateMatrixWorld(true);
     if(camera.projectionMatrix)botCamera.projectionMatrix.copy(camera.projectionMatrix);
     if(camera.projectionMatrixInverse)botCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
     const previousBackground=scene.background,previousAuto=renderer.autoClear;
     const clearColor=this._labClearColor??(this._labClearColor=new T.Color());
     renderer.getClearColor(clearColor);const previousAlpha=renderer.getClearAlpha();
     try{
      scene.background=null;renderer.autoClear=true;renderer.setClearColor('#000000',0);
      renderer.setRenderTarget(target);renderer.render(scene,botCamera);
     }finally{
      renderer.setRenderTarget(null);
      scene.background=previousBackground;renderer.autoClear=previousAuto;renderer.setClearColor(clearColor,previousAlpha);
     }
     const worldDepth=worldTarget?.depthTexture??null;
     this._encodeLabSource(target,display);
     this._compositeLab(lab,this._targetState('bots'),display,{keepAlpha:true,depthTest:!!worldDepth,worldDepth,botDepth:target.depthTexture??null});
      return true;
     }
     _hasVisibleBots(){
      if(!this.actorModels?.size)return false;
      const camera=this.camera;
      camera.updateMatrixWorld();
      const matrix=this._botFrustumMatrix??(this._botFrustumMatrix=new T.Matrix4()),frustum=this._botFrustum??(this._botFrustum=new T.Frustum());
      matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix,camera.coordinateSystem,camera.reversedDepth);
      for(const model of this.actorModels.values())if(hasLayerContent(model,1<<BOT_LAYER,frustum))return true;
      return false;
     }
     _renderWorldLayers(botWanted){
      if(this.perf)this.perf.botLayer=false;
      if(!this.composer){this.renderer.render(this.scene,this.camera);return;}
      const scene=this.scene,previousMatrices=scene.matrixWorldAutoUpdate;
      // A styled frame renders the SAME transforms for shadow refresh, world,
      // and bots. Update once, then reuse them across all three traversals.
      // This also lets the empty-layer check use exact mesh frustum bounds.
      if(botWanted){if(previousMatrices===true)scene.updateMatrixWorld();scene.matrixWorldAutoUpdate=false;}
      try{
       const botsStyled=botWanted&&!!(this._botLab&&this._botTarget&&this._labDisplayTarget)&&this._hasVisibleBots();
       if(this.perf)this.perf.botLayer=botsStyled;
       const worldTarget=botsStyled?this.composer.readBuffer:null;
       this._syncWorldCamera(botsStyled);
       if(botsStyled){
        this._refreshBotShadowCasters();
        const previousAuto=this.renderer.autoClear;this.renderer.autoClear=false;
        try{this.composer.render();}finally{this.renderer.autoClear=previousAuto;}
        this._renderBotLayer(worldTarget);
       }else this.composer.render();
      }finally{scene.matrixWorldAutoUpdate=previousMatrices;}
     }
    // Weapon stack: the viewmodel renders to its own transparent target and is
    // composited with normal alpha blending. The direct path stays untouched
    // while the weapon target is off.
    _renderWeaponLayer(weaponCamera){
     const lab=this._weaponLab,target=this._weaponTarget,display=this._labDisplayTarget,renderer=this.renderer,scene=this.weaponScene;
     if(!lab||!target||!display||!scene||!weaponCamera)return false;
     const previousAuto=renderer.autoClear;
     const clearColor=this._labClearColor??(this._labClearColor=new T.Color());
     renderer.getClearColor(clearColor);const previousAlpha=renderer.getClearAlpha();
     try{
      renderer.autoClear=true;renderer.setClearColor('#000000',0);
      renderer.setRenderTarget(target);renderer.render(scene,weaponCamera);
     }finally{
      renderer.setRenderTarget(null);
      renderer.autoClear=previousAuto;renderer.setClearColor(clearColor,previousAlpha);
     }
     this._encodeLabSource(target,display);
     this._compositeLab(lab,this._targetState('weapon'),display,{keepAlpha:true,depthTest:false});
     return true;
    }
    buildArena(arena=MAPS[0]){clearLatticeWorld(this);return withAssets(this.arenaAssets??=new ModelAssets(),()=>this._buildArena(arena));}
    _buildArena(arena=MAPS[0]){this._disposeMothSprites();if(this.worldGroup){this.scene.remove(this.worldGroup);this.disposeObject(this.worldGroup);for(const resource of this.renderResources||[])resource.dispose();this.renderResources?.clear();this.flagAssets=null;}this.sky=null;this.mountains=null;this.backdrop=null;this.objectiveModels=new Map();this.interiors=buildInteriors(arena.structures||[]);this._interiorBlend=0;this._mothRift=null;this._mothRiftSheet=null;this.mapId=arena.id;this.viewAudio?.setSpace?.(mothSpaceFor(arena.id));this.viewAudio?.setEchoMap?.(mothEchoFor(arena.id));applyArenaBiomePalette(this.viewAudio,arena);const world=new T.Group();this.worldGroup=world;this.scene.add(world);this.scene.background=new T.Color(arena.background);this.scene.fog=new T.FogExp2(arena.background,.018);const bounds=arenaBounds(arena),legacy=!arena.bounds,minX=bounds.minX,maxX=bounds.maxX,minZ=bounds.minZ,maxZ=bounds.maxZ,width=maxX-minX,depth=maxZ-minZ;
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
    const applyTextures=(mat,kind,rx,ry,key)=>this._mothSurface(mat,kind,rx,ry,arenaSeed,key);
    const variantBuckets={block:new Map(),detail:new Map(),terrain:new Map(),terrainWall:new Map()};
    const variant=(scope,base,{map=false,kind='rock'}={})=>{const bucket=variantBuckets[scope];let clone=bucket.get(base);if(!clone){clone=base.clone();clone.vertexColors=true;clone.map=null;clone.normalMap=null;clone.roughnessMap=null;if(map)applyTextures(clone,kind,1,1,`${scope}:${kind}`);bucket.set(base,clone);palette.push(clone);}return clone;};
    const floorKind=arena.id==='neon-vertical'||arena.id==='crosswire'?'holographic_grid':(arena.id==='foundry'?'diamond_plate':(['ironfall-megastructure','substation','citadel','derelict-station'].includes(arena.id)?'metal_grating':(['launchpad','catwalk-breach'].includes(arena.id)?'carbon_fiber':'weathered_concrete')));
    applyTextures(floor,floorKind,FLOOR_TEXTURE_REPEAT,FLOOR_TEXTURE_REPEAT,`floor:${floorKind}`);
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
    // Shadow camera: the arena half-extent fits the first bake, then the shadow
    // cadence re-centres it on a view-tight box (`_fitShadowFrustum`). The arena
    // ground color keeps shadowed surfaces tinted.
    if(this.sun){const centerX=(minX+maxX)/2,centerZ=(minZ+maxZ)/2,extent=Math.max(width,depth)/2+10;this._shadowFit={offsetX:arena.id==='aether'?-18:18,offsetZ:arena.id==='foundry'?-12:12,height:26,arenaExtent:extent};this._shadowFitX=this._shadowFitZ=this._shadowFitHalf=undefined;this._fitShadowFrustum(centerX,centerZ,extent);if(this.sun.shadow){this.sun.shadow.bias=-.0006;this.sun.shadow.normalBias=.03;}}
    // Bake shallow cladding into a handful of ordinary meshes, not hundreds of draw calls.
    const detail=(w,h,d,x,y,z,rawMat)=>{if(Math.min(w,h,d)<=0)return;const mat=variant('detail',rawMat);let entry=detailBatches.get(mat);if(!entry){entry={positions:[]};detailBatches.set(mat,entry);}const p=unit.attributes.position,positions=entry.positions;for(let i=0;i<p.count;i++)positions.push(x+p.getX(i)*w,y+p.getY(i)*h,z+p.getZ(i)*d);};
   if(!islands&&!arena.terrain){
    // Subdivide the floor. On WebGL the tiles are merged into a single material
    // batch (one draw call instead of hundreds), preserving each tile's UVs,
    // normals and shadow receive. The CPU renderer keeps separate tiles because
    // its painter depth ordering needs the smaller surfaces.
    const tile=FLOOR_TILE,tiles=[];
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
  const rockMat=applyTextures(material('#827d67',.02,.98),'rock',2,2,'rock:ground'),teamMats=TEAM_PALETTE.map(team=>material(team.color,.15,.8));
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
    if(arena.race)raceTrackModel(arena.race,arena.color,world,undefined,{quality:this._quality(),surface:(mat,kind,rx,ry)=>this._mothSurface(mat,kind,rx,ry,arenaSeed,`race:${kind}`)});
    this.buildNextGen(world,arena);
   this.addTraversal(world,arena,glow);
   // Chunked static-architecture batches (real WebGL only; the CPU renderer and
   // the test mock keep individual meshes for predictable depth ordering).
   this._batchArenaBlocks(world);
   // Unused family colors never reach the scene's normal disposal traversal.
    const usedMaterials=new Set();world.traverse(n=>{if(n.material)usedMaterials.add(n.material);});for(const mat of new Set(palette))if(!usedMaterials.has(mat))mat.dispose();   const skyPhaseName=skyPhase(arena),halo=HALO_MAPS.has(arena.id),sunDir=arena.id==='aether'?[-18,24,-12]:arena.id==='foundry'?[18,24,-12]:[18,24,10],quality=this._quality();this.scene.userData.sky={background:arena.background,phase:skyPhaseName,seed:arenaSeed,halo,sunDir,mood:biomeAmbience(arena).mood,weather:this.weatherState?this.weatherState.kind:'clear'};if(this.renderer?.isSoftware!==true){this.sky=addSky(world,{background:arena.background,radius:185,phase:skyPhaseName,seed:arenaSeed,starCount:Math.round((skyPhaseName==='night'?520:0)*quality.stars),halo,sunDir});this.mountains=addMountains(world,{background:arena.background,seed:arenaSeed,radius:150,count:Math.max(8,Math.round(26*quality.scatter)),base:-12,detail:quality.scatterDetail});this.backdrop=addBackdrop(world,{biome:backdropKitFor(arena).biome,seed:arenaSeed,quality});if(arena.terrain&&arena.scatter!==false)this.scatterWind=addScatter(world,{terrain:arena.terrain,bounds,seed:arenaSeed,wind:true,density:quality.scatter,detail:quality.scatterDetail,biome:arena.biome})||[];const atmosphere=mothAtmosphereFor(arena.id);if(atmosphere)this._applyMothAtmosphere(atmosphere);}
    else this.scatterWind=[];
    this.ambientFx=null;this.ambientPool?.dispose?.();this.ambientPool=null;this.ambientConfig=ambientProfile(arena,skyPhaseName);this.ambientSeed=arenaSeed;this.ambientAnchors=smokeAnchors(bounds,arenaSeed,4);
    this.weatherFx=null;this.weatherPool?.dispose?.();this.weatherPool=null;this.ripplePool?.clear?.();this.initWeather(arena);
   if(this.renderer?.shadowMap)this.renderer.shadowMap.needsUpdate=true;
  }
  // Fit (or re-fit) the ortho shadow camera on a quantized world focus. The
  // arena build calls this once with the full arena extent for the first bake;
  // every later call trades that footprint for a ~40 m view-tight box. Moving
  // the light and its target together keeps the authored light direction, and
  // the quantization step means the projection only changes when the box
  // actually pans. Returns false when the quantized box did not move.
  _fitShadowFrustum(focusX,focusZ,half=SHADOW_FIT_EXTENT){
   const sun=this.sun,fit=this._shadowFit;
   if(!sun?.shadow?.camera||!fit)return false;
   const quantum=Math.max(.5,Number(SHADOW_FIT_QUANTUM)||1);
   const x=Math.round((Number(focusX)||0)/quantum)*quantum,z=Math.round((Number(focusZ)||0)/quantum)*quantum;
   const h=Math.max(6,Math.min(Math.max(6,Number(half)||SHADOW_FIT_EXTENT),fit.arenaExtent));
   if(this._shadowFitX===x&&this._shadowFitZ===z&&this._shadowFitHalf===h)return false;
   this._shadowFitX=x;this._shadowFitZ=z;this._shadowFitHalf=h;
   if(this.sunTarget)sun.target=this.sunTarget;
   if(sun.target){sun.target.position.set(x,0,z);sun.target.updateMatrixWorld?.(true);}
   sun.position.set(x+fit.offsetX,fit.height,z+fit.offsetZ);
   const camera=sun.shadow.camera,distance=Math.hypot(fit.offsetX,fit.height,fit.offsetZ);
   camera.left=-h;camera.right=h;camera.top=h;camera.bottom=-h;
   camera.near=.5;camera.far=distance+h*2.5+fit.height+60;
   camera.updateProjectionMatrix();
   return true;
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
    // Static additive dust shafts where daylight falls through the opening.
    // WebGL-only (they need additive blending), motionless by construction and
    // owned by the shared-resource disposal path like the cavern shell itself.
    if(this.renderer?.isSoftware!==true){
     const shaftHeight=Math.max(2,shell.wallHeight+shell.domeHeight*.55),shaftGeo=geo(`cavshaft|${shell.radius}`,()=>new T.ConeGeometry(shell.radius*.34,1,10,1,true)),shaftMat=new T.MeshBasicMaterial({color:arena.color,transparent:true,opacity:.05,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide});
     shared.add(shaftMat);
     for(const side of[-1,1]){const beam=new T.Mesh(shaftGeo,shaftMat);beam.position.set(s.x+side*shell.radius*.3,base+shaftHeight/2,s.z);beam.scale.set(1,shaftHeight,1);beam.rotation.z=side*.12;beam.userData.dustShaft=true;world.add(beam);}
    }
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
   const index=counters[p.type]++,matrix=new T.Matrix4();
   mesh.getMatrixAt(index,matrix);
   // Base transform and tint captured once so a partial hit can shrink and
   // darken the intact instance without ever re-reading a staged matrix.
   const color=mesh.instanceColor?mesh.getColorAt(index,new T.Color()):null;
   entries.push({prop:p,id:propId(p,i),mesh,index,matrix,color,stage:0});
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
   if(!result)continue;
   if(result.broken){
    if(result.wasBroken)continue;
    data.hidden.add(entry.id);
    entry.mesh.setMatrixAt(entry.index,zero);entry.mesh.instanceMatrix.needsUpdate=true;
    const plan=propBreakPlan({...p,id:entry.id},{origin:pos,serial,reduced});
    if(plan){this.debrisPool??=new DebrisPool(this.scene,this._quality().deaths);this.debrisPool.spawn(plan);}
    broken++;
    continue;
   }
   // Partial damage: stage the intact instance (shrink + darken) so the break
   // reads as a progression instead of pristine -> hidden. WebGL only — the CPU
   // renderer returns before this point — and monotonic per prop.
   const stage=propDamageStage(result.hp,result.profile);
   if(stage.progress<=0||stage.progress<=entry.stage)continue;
   entry.stage=stage.progress;
   const scaled=this._stageMatrix??=new T.Matrix4(),tint=this._stageColor??=new T.Color(),stageScale=this._stageScale??=new T.Matrix4();
   stageScale.makeScale(stage.scale,stage.scale,stage.scale);
   scaled.copy(entry.matrix).multiply(stageScale);
   entry.mesh.setMatrixAt(entry.index,scaled);
   entry.mesh.instanceMatrix.needsUpdate=true;
   if(entry.color)tint.copy(entry.color);else tint.setScalar(1);
   tint.multiplyScalar(stage.shade);
   entry.mesh.setColorAt(entry.index,tint);
   if(entry.mesh.instanceColor)entry.mesh.instanceColor.needsUpdate=true;
  }
  return broken;
 }
  _updateDebris(delta){if(this.renderer?.isSoftware===true||!this.debrisPool)return 0;this.debrisPool.update(delta);let active=0;for(const slot of this.debrisPool.slots)if(slot.active)active++;return active;}
 makeMenu(){const scene=new T.Scene();scene.background=new T.Color('#080f13');scene.fog=new T.FogExp2('#080f13',.055);const camera=new T.PerspectiveCamera(38,1,.1,80);camera.position.set(5,3.3,10);camera.lookAt(0,1.4,0);scene.add(new T.HemisphereLight('#bdedee','#233139',2.8));const key=new T.DirectionalLight('#e4fff3',4);key.position.set(-4,6,5);scene.add(key);const rim=new T.PointLight('#52e5cf',80,15);rim.position.set(3,3,-3);scene.add(rim);
 const dark=material('#152128',.8,.4),glow=material('#67e7d3',.4,.2,true),ringGlow=this._mothLutMaterial('entanglement',{base:{color:'#67e7d3',metalness:.4,roughness:.2,emissive:'#67e7d3'},phase:.1,intensity:.45})||glow;if(ringGlow!==glow)this.sharedResources.add(ringGlow);box(scene,50,.3,50,0,-.35,0,dark);const grid=new T.GridHelper(40,40,'#284443','#192c31');grid.position.y=-.19;scene.add(grid);cylinder(scene,1.55,1.8,.3,0,-.02,0,dark,48);ring(scene,1.57,.018,0,.15,0,ringGlow);ring(scene,2.05,.014,0,-.16,0,ringGlow);ring(scene,2.2,.01,0,-.16,0,ringGlow);
 for(let i=-4;i<=4;i++){box(scene,.25,9,.5,i*3,4,-6,dark);box(scene,.045,6,.04,i*3+.18,4,-5.72,glow);}
  const model=robotModel('chatgpt',undefined,this.renderer?.isSoftware===true);model.scale.setScalar(2.15);model.position.y=.17;model.rotation.y=.25;scene.add(model);return {scene,camera,model,id:'chatgpt'};}
  setCharacter(id){if(id===this.menu.id)return;this.disposeObject(this.menu.model);this.menu.scene.remove(this.menu.model);this.menu.model=robotModel(id,undefined,this.renderer?.isSoftware===true);this.menu.model.scale.setScalar(2.15);this.menu.model.position.y=.17;this.menu.scene.add(this.menu.model);this.menu.id=id;}
      setMatch(match){this.clearFreeMotion();this.characterLifecycle?.clear();this.deathContext?.clear();this.deathPool?.clear();this.hitPool?.clear();this.hitFlinch?.clear();this.shellPool?.clear();this.ripplePool?.clear?.();this.contactShadows?.clear?.();this.abilityVfx?.reset();this._clearDebugDeaths?.();const arena=match.arena||MAPS.find(a=>a.id===match.mapId)||MAPS[0];this.clearObjectiveMarkers();if(this.payloadModel){this.scene.remove(this.payloadModel);this.disposeObject(this.payloadModel);this.payloadModel=null;}for(const m of [...this.actorModels.values(),...this.pickupModels,...(this.flagModels||new Map()).values(),...(this.deployableModels||new Map()).values()]){this.scene.remove(m);this.disposeObject(m);}this.flagModels=new Map();this.deployableModels=new Map();if(this.mapId!==arena.id)this.buildArena(arena);const assets=this.modelAssets??=new ModelAssets();this.actorModels=new Map((match.actors||[]).map(a=>{const m=robotModel(a.character,assets,this.renderer?.isSoftware===true);this._addActorModel(m);return [a.id,m];}));this.pickupModels=(match.pickups||[]).map(p=>{const g=new T.Group(),colors=PICKUP_COLORS,pickupColor=colors[p.kind]||'#8ad9d3',mat=this._mothLutMaterial(this._mothLutTheme(arena),{base:{color:pickupColor,metalness:.4,roughness:.3,emissive:pickupColor},phase:.15,intensity:.4})??material(pickupColor,.4,.3,true);if(p.kind==='health'){box(g,.6,.19,.19,0,.65,0,mat);box(g,.19,.6,.19,0,.65,0,mat);}else if(p.kind==='armor'){const m=new T.Mesh(geometry(assets,'pickup-armor-octa',()=>new T.OctahedronGeometry(.4)),mat);m.position.y=.7;g.add(m);}else if(['haste','overcharge','overshield'].includes(p.kind)){const m=new T.Mesh(geometry(assets,'pickup-power-ico',()=>new T.IcosahedronGeometry(.36,1)),mat);m.position.y=.7;g.add(m);ring(g,.55,.022,0,.07,0,mat);}else{const w=simpleWeaponModel(pickupWeapon(p.kind),assets);w.position.y=.75;w.scale.setScalar(.7);g.add(w);}if(!['haste','overcharge','overshield'].includes(p.kind))ring(g,.55,.022,0,.07,0,mat);g.position.set(p.x||0,p.y||0,p.z||0);this.scene.add(g);return g;});this._trackAssets(assets);this.syncVehicles(match);this.updateFlags(match,arena);this.updateObjectives(match,arena);this.effectPool?.clear();this.telegraphPool?.clear();for(const m of this.zipCarriages?.values()||[]){this.scene.remove(m);this.disposeObject(m);}this.zipCarriages?.clear();this._fovPulse=0;this.projectilePool?.clear();this.altProjectiles?.clear();this._clearMothSprites();this.railPool?.clear();this.deathContext?.clear();this.deathPool?.clear();this.decalPool?.clear();this.ambientFx?.reset();this.debrisPool?.clear();this.hitFlinch?.clear();this.hitPool?.clear();this._killcam=null;this.feedback?.reset();this.cameraShake?.reset();this.lowHealth=false;this.flashUntil=0;this.lastEvent=match.serial||0;this.currentWeapon=-1;this._adsTransition=0;this._adsController?.reset(this.display?.fov??82);this._nearActionAt=undefined;this._nearAction=0;this._cocsPresentation=null;this.followMarkers?.clear();this.resetPresentation();
  // Per-mode music theme. The audio object retunes its running drone in place.
  const mode=match.config?.mode??match.mode;if(mode)this.viewAudio?.setModeTheme?.(mode);this._modeTheme=mode??this._modeTheme;}
      syncActors(match){const actors=match?.actors||[];for(const actor of actors)if(!this.actorModels.has(actor.id)){const model=robotModel(actor.character,this.modelAssets??=new ModelAssets(),this.renderer?.isSoftware===true);applyActorTeam(model,actor.team,this.display?.teamPalette);this._addActorModel(model);this.actorModels.set(actor.id,model);}const live=new Set(actors.map(actor=>actor.id));for(const [id,model] of this.actorModels)if(!live.has(id)){this.characterLifecycle?.release(model);this.scene.remove(model);this.disposeObject(model);this.actorModels.delete(id);}}
      styleActor(model,actor,palette){if(this.characterLifecycle?.ownsTransform(model))return;applyActorTeam(model,actor.team,palette);const profile=actor?.npcProfile;if(!profile)return;const data=model.userData||{};if(data.base?.material?.color)data.base.material.color.set(profile.color);if(data.armor?.color)data.armor.color.set(profile.accent||profile.color);model.scale.setScalar(profile.scale??1);}
      updateWaypoint(match,arena){const waypoint=match?.waypoint;if(!waypoint){if(this.waypointModel){this.scene.remove(this.waypointModel);this.disposeObject(this.waypointModel);this.waypointModel=null;this.waypointId=null;}return;}if(!this.waypointModel||this.waypointId!==waypoint.id){if(this.waypointModel){this.scene.remove(this.waypointModel);this.disposeObject(this.waypointModel);}this.waypointId=waypoint.id;this.waypointModel=this.createObjectiveModel({id:'waypoint',x:waypoint.x,y:waypoint.y??0,z:waypoint.z,radius:waypoint.radius??4,label:waypoint.label},arena);this.scene.add(this.waypointModel);}this.waypointModel.position.set(waypoint.x,waypoint.y??0,waypoint.z);}
   createFlagModel(team,arena){const resources=this.renderResources??=new Set(),color=this.objectiveColor(team,arena);const assets=this.flagAssets??={},poleGeo=assets.pole??=new T.CylinderGeometry(.035,.05,1.8,8),bannerGeo=assets.banner??=new T.BoxGeometry(.52,.32,.035),baseGeo=assets.base??=new T.CylinderGeometry(.34,.42,.08,16),mat=this._mothLutMaterial('entanglement',{base:{color,metalness:.35,roughness:.3,emissive:color},phase:.3,intensity:.5})??material(color,.35,.3,true);resources.add(poleGeo);resources.add(bannerGeo);resources.add(baseGeo);const g=new T.Group();const pole=new T.Mesh(poleGeo,mat);pole.position.y=.9;g.add(pole);const banner=new T.Mesh(bannerGeo,mat);banner.position.set(.24,1.55,0);g.add(banner);for(const z of [-.025,.025]){const mark=teamMark();mark.position.set(.24,1.55,z);updateTeamMark(mark,team);g.add(mark);}const base=new T.Mesh(baseGeo,mat);base.position.y=.04;g.add(base);g.userData={team,teamLabel:teamPresentation(team,this.display?.teamPalette)?.label??null,flag:true,banner,material:mat};return g;}
     updateFlags(match,arena=MAPS[0]){this.updateVehicleModels(match);const input=match?.flags;if(!input){for(const g of this.flagModels?.values()||[])g.visible=false;return;}const flags=Array.isArray(input)?input:Object.entries(input).map(([team,flag])=>({...flag,team:flag?.team??team}));const active=new Set();for(const flag of flags.slice(0,8)){if(!flag)continue;const team=flag.team??flag.teamId??flag.id??0,key=String(team);let g=this.flagModels.get(key);if(!g){g=this.createFlagModel(team,arena);this.flagModels.set(key,g);this.scene.add(g);}active.add(key);const carrier=flag.carrier??flag.carrierId??flag.carriedBy;g.visible=carrier==null&&flag.state!=='carried'&&flag.status!=='carried';const p=pointOf(flag);g.position.set(p.x||0,p.y||0,p.z||0);g.rotation.y=flag.yaw??0;const dropped=flag.dropped===true||flag.state==='dropped'||flag.status==='dropped';const pulse=dropped&&!this.reduced();g.scale.setScalar(pulse?1+Math.sin((match.time||0)*7)*.08:1);g.userData.banner.material.opacity=dropped?.75:1;g.userData.banner.material.transparent=true;const flagColor=this.objectiveColor(team,arena),flagMaterial=g.userData.material;if(flagMaterial){flagMaterial.color.set(flagColor);flagMaterial.emissive?.set(flagColor);g.userData.banner.material.color.set(flagColor);}}for(const [key,g] of this.flagModels)if(!active.has(key))g.visible=false;}
     objectiveColor(team,arena,neutral=NEUTRAL){return teamPresentation(team,this.display?.teamPalette)?.color??neutral;}
     // Zone team marks. A contested zone keeps a readable owner mark instead of
     // hiding it: the owner's bars when owned, one centred neutral bar when
     // split or unowned. The zone pulse and the amber tint carry the contest, so
     // the mark never disappears exactly when the fight is for the hill.
     _styleZoneMark(mark,zone){
      if(!mark?.children?.length)return null;
      const owner=zone?.owner===0||zone?.owner===1?zone.owner:null,contested=zone?.contested===true;
      updateTeamMark(mark,owner);
      if(contested&&owner===null){mark.visible=true;mark.children[0].visible=true;mark.children[0].position.x=0;mark.children[1].visible=false;}
      const material=mark.children[0].material;
      if(material?.color)material.color.set(contested?'#ffd166':'#fff4dc');
      return mark;
     }
       createObjectiveModel(zone,arena){const radius=Math.max(.8,Number(zone.radius)||3.5),progressValue=Math.max(0,Math.min(100,Number(zone.progress)||0)),software=this.renderer?.isSoftware===true,g=new T.Group(),tint=this.objectiveColor(zone.owner,arena),lutName=this._mothLutTheme(arena),baseMat=material(tint,.25,.3,true),areaMat=material(tint,.15,.8,true),progressMat=this._mothLutMaterial(lutName,{base:{color:'#ffd166',metalness:.2,roughness:.25,emissive:'#ffd166'},phase:.45,intensity:.7})??material('#ffd166',.2,.25,true),beaconMat=this._mothLutMaterial(lutName,{base:{color:tint,metalness:.25,roughness:.3,emissive:tint},phase:.15,intensity:.6})??material(tint,.25,.3,true),beacon=cylinder(g,.09,.16,2.4,0,1.2,0,beaconMat,10),area=new T.Mesh(new T.CylinderGeometry(radius,radius,.035,32),areaMat),base=ring(g,radius,.11,0,.05,0,baseMat),progress=new T.Mesh(software?new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progressValue/100):new T.RingGeometry(radius-.2,radius+.2,32),progressMat),emblem=new T.Mesh(new T.CylinderGeometry(.34,.34,.08,8),progressMat);for(const mat of [baseMat,areaMat,progressMat])mat.depthWrite=false;beaconMat.depthTest=false;beaconMat.depthWrite=false;area.position.y=.018;area.renderOrder=1;base.renderOrder=1;progress.rotation.x=-Math.PI/2;progress.position.y=.07;progress.renderOrder=1;emblem.position.y=.13;emblem.renderOrder=1;beacon.renderOrder=100;if(!software)progress.geometry.setDrawRange(0,0);g.add(area,progress,emblem);g.userData={objective:true,area,base,beacon,progress,emblem,areaMat,baseMat,progressMat,beaconMat,radius,identifier:String(zone.id??'zone')};g.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});return g;}
     clearObjectiveMarkers(){clearLatticeWorld(this);for(const g of this.objectiveModels?.values()||[]){this.worldGroup?.remove(g);this.disposeObject(g);}this.objectiveModels?.clear();}
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
     // the LUT texture itself is a shared cache owned by textures.mjs. The arena
     // family picks the LUT; see `mothLutThemeFor` above.
     _mothLutTheme(arena){return mothLutThemeFor(arena?.id);}
     _mothLutMaterial(name,{base={},phase=.35,intensity=.9,track=false}={}){
      if(this.renderer?.isWebGLRenderer!==true)return null;
      const lut=mothMaterialLutTexture(name);
      if(!lut)return null;
      const mat=createMothLutMaterial({lut,base,phase,intensity});
      if(track)(this.renderResources??=new Set()).add(mat);
      return mat;
     }
     // Apply the baked Moth surface maps to a material. The macro anti-tiling
     // enhancer runs on WebGL only; grid kinds now get structure-preserving wear
     // instead of the old no-op, and organic kinds get world-space break-up. The
     // CPU renderer keeps its flat authored materials. `variantKey` is the
     // replay-stable wear identity (arena|kind|repeat|region), so one wall never
     // restyles itself between visits. Shared by the arena build, next-gen
     // props/structures and race/soccer presentation.
     _mothSurface(mat,kind,rx,ry,seed=1,variantKey){
      if(!mat||this.renderer?.isSoftware===true||typeof document==='undefined')return mat;
      const key=variantKey||`${seed}:${kind}:${rx}x${ry}`;
      const maps=surfaceTextures(kind,{seed,repeat:[rx,ry],variantKey:key});
      if(maps){mat.map=maps.map;mat.roughnessMap=maps.roughnessMap;mat.normalMap=maps.normalMap;mat.normalScale=new T.Vector2(.6,.6);}
      if(maps&&this.renderer?.isWebGLRenderer===true)enhanceMothMaterial(mat,{kind,macro:mothMacroTexture(),seed:key});
      return mat;
     }
     // Advance the Moth arena's animated rift: cycle the baked effect frames and
     // slowly tumble the iridescent landmark.
     // Reduced motion freezes the rift: no frame cycling, no landmark tumble.
     updateMothRift(time,reduced=false){if(reduced)return null;const sheet=this._mothRiftSheet,t=Number.isFinite(time)?time:0;if(sheet){const i=Math.floor((t*sheet.fps)%sheet.frames.length);if(i!==sheet.index){sheet.index=i;sheet.mat.map=sheet.frames[i];sheet.mat.needsUpdate=true;}if(sheet.mesh)sheet.mesh.rotation.z=t*.08;}if(this._mothRift){this._mothRift.rotation.y=t*.35;this._mothRift.rotation.x=Math.sin(t*.2)*.25;}}
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
      // Checkpoint tick ring: six fixed ticks on the ground hoop, lit one per
      // banked checkpoint. The slots are built once from one shared tiny
      // geometry; unused ticks stay hidden.
      const ticks=tag(new T.Group());ticks.name='payload-ticks';ticks.position.y=-1.18;g.add(ticks);
      const tickGeo=new T.BoxGeometry(.16,.05,.1),tickPending=material('#5b6470',.3,.5);
      for(let i=0;i<6;i++){const tick=tag(new T.Mesh(tickGeo,tickPending));tick.visible=false;tick.renderOrder=90;ticks.add(tick);}
      let question=null;
      if(typeof document!=='undefined'&&typeof document.createElement==='function'){question=textLabel(g,'?',0,2.35,0,.6,'#ffffff');question.userData.objective=true;question.userData.noCameraOcclusion=true;}
      g.userData={payload:true,body,snout,wings,trotters,beacon,halo,ring,ticks,tickGeo,tickPending,accentMaterials:[accent,glow],question,lastPosition:null};
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
      // Payload state on the existing rings: banked progress grows the ground
      // hoop, a contest beats it, delivery flares the emblem halo, and pushing
      // reads through the already team-tinted accent materials. Reduced motion
      // holds every ring static.
      const total=Math.max(1,Number(payload.total)||1),progress=Math.max(0,Math.min(1,(Number(payload.distance)||0)/total)),state=payload.delivered===true?'delivered':payload.contested===true?'contested':payload.pushing===0||payload.pushing===1?'pushing':'idle';
      const beacon=g.userData.beacon,halo=g.userData.halo,ring=g.userData.ring;
      if(beacon)beacon.material.emissiveIntensity=state==='delivered'?1.6:reduced?1:1+.6*Math.sin(t*4);
      if(halo)halo.scale.setScalar(state==='delivered'?1.3:state==='contested'&&!reduced?1+.12*Math.sin(t*6):reduced?1:1+.08*Math.sin(t*4));
      if(ring){ring.scale.setScalar(1+progress*.2+(state==='contested'&&!reduced?Math.abs(Math.sin(t*6))*.08:0));ring.rotation.z=reduced?0:t*.6;}
      this._syncPayloadTicks(g,payload);
      g.userData.payloadState=state;
     }
     // Light one tick per banked checkpoint on the payload's ground hoop. Always
     // six slots, so the tick count never allocates during a match; reached ticks
     // take the state-tinted accent material and a slightly larger scale.
     _syncPayloadTicks(g,payload){
      const data=g?.userData,ticks=data?.ticks;
      if(!ticks?.children?.length)return 0;
      const count=Math.max(0,Math.min(ticks.children.length,Array.isArray(payload?.checkpoints)?payload.checkpoints.length:0)),reached=Math.max(0,Math.min(count,Number(payload?.checkpointsReached)||0)),lit=data.accentMaterials?.[1]??data.accentMaterials?.[0]??data.tickPending;
      ticks.visible=count>0;
      for(let i=0;i<ticks.children.length;i++){
       const tick=ticks.children[i],show=i<count;
       tick.visible=show;
       if(!show)continue;
       const angle=(i+.5)/count*Math.PI*2,on=i<reached;
       tick.position.set(Math.sin(angle)*1.5,0,Math.cos(angle)*1.5);
       tick.rotation.y=angle;
       tick.material=on?lit:data.tickPending;
       tick.scale.setScalar(on?1.18:1);
      }
      data.ticksReached=reached;data.tickCount=count;
      return reached;
     }
      // DEPLOYABLE SENTRIES. The sim fires from them while the renderer never
      // drew one; this mirrors the pickup lifecycle: one shared-geometry model
      // per live deployable id, rebuilt from the snapshot on first sight and
      // disposed when the sentry leaves it. Software gets a flat blob shadow,
      // WebGL reuses the contact-shadow pool through the `d:` keys.
      updateDeployables(match,reduced=this.reduced()){
       const list=Array.isArray(match?.deployables)?match.deployables.slice(0,4):[];
       this.deployableModels??=new Map();
       const active=new Set(),software=this.renderer?.isSoftware===true,arena=match?.arena||MAPS.find(map=>map.id===match?.mapId)||MAPS[0],time=Number(match?.time)||0;
       for(const sentry of list){
        if(!sentry||sentry.id===undefined||sentry.id===null)continue;
        const id=sentry.id;active.add(id);
        let g=this.deployableModels.get(id);
        if(!g){g=this._buildDeployableModel(sentry.team,arena,software);this.deployableModels.set(id,g);this.scene.add(g);}
        g.position.set(Number(sentry.x)||0,Number(sentry.y)||0,Number(sentry.z)||0);
        // Aim the head at the nearest enemy in range. The sim owns targeting;
        // this only re-reads the same actor list for presentation and freezes
        // under reduced motion.
        const head=g.userData.head;
        if(head){
         if(reduced)head.rotation.y=0;
         else{const target=this._sentryTarget(sentry,match);head.rotation.y=target?Math.atan2(-((Number(target.x)||0)-(Number(sentry.x)||0)),-((Number(target.z)||0)-(Number(sentry.z)||0))):0;}
        }
        const eye=g.userData.eye;
        if(eye?.material)eye.material.emissiveIntensity=reduced ? .85 : .85+.25*Math.sin(time*3+(Number(id)||0));
       }
       for(const [id,g] of this.deployableModels)if(!active.has(id)){this.scene.remove(g);this.disposeObject(g);this.deployableModels.delete(id);}
       return this.deployableModels.size;
      }
      _sentryTarget(sentry,match){
       const sx=Number(sentry?.x)||0,sz=Number(sentry?.z)||0,range=Math.max(1,Number(sentry?.range)||22);
       let best=null,bestDistance=Infinity;
       for(const actor of match?.actors||[]){
        if(!actor||actor.health<=0||actor.id===sentry?.owner)continue;
        if(Number.isFinite(sentry?.team)&&actor.team===sentry.team)continue;
        const distance=Math.hypot((Number(actor.x)||0)-sx,(Number(actor.z)||0)-sz);
        if(distance<=range&&distance<bestDistance){bestDistance=distance;best=actor;}
       }
       return best;
      }
      // Small team-tinted turret from the same shared-primitive kit as the other
      // models: base + column + head + barrel + emissive eye. Geometry and
      // materials are cached on a view-owned ModelAssets and tracked as shared,
      // so removing one model never frees a sibling's geometry.
      _buildDeployableModel(team,arena,software=false){
       const assets=this._deployableAssets??=new ModelAssets();
       const model=withAssets(assets,()=>{
        const tint=this.objectiveColor(team,arena),accent=material(tint,.35,.3,true),dark=material('#20262b',.62,.42),metal=material('#5c666f',.7,.35),g=new T.Group();
        cylinder(g,.42,.5,.16,0,.08,0,accent,12,assets);
        box(g,.42,.3,.5,0,.3,0,dark,assets);
        cylinder(g,.16,.2,.34,0,.55,0,metal,10,assets);
        ring(g,.5,.03,0,.17,0,accent,Math.PI/2,assets);
        const head=new T.Group();head.position.y=.74;g.add(head);
        box(head,.46,.34,.44,0,0,0,dark,assets);
        box(head,.09,.09,.66,0,-.02,-.42,metal,assets);
        const eye=box(head,.2,.09,.05,0,.03,-.24,accent,assets);
        // The eye owns a cloned emissive material so its idle pulse never
        // brightens a sibling turret sharing the cached accent material.
        eye.material=eye.material.clone();
        if(software)addBlobShadow(g,.5,.32);
        g.userData={sentry:true,head,eye};
        return g;
       });
       this._trackAssets(assets);
       return model;
      }
      // Objective beacons grow with captured progress so a distant zone reads
      // its capture state from silhouette alone. Only scale/emissive change:
      // the thin, never-occluded geometry contract stays untouched.
      _applyBeaconProgress(g,progress){
       const beacon=g?.userData?.beacon;if(!beacon)return 0;
       const p=Math.max(0,Math.min(1,(Number(progress)||0)/100)),height=1+p*.9;
       beacon.scale.y=height;
       beacon.position.y=(Number(beacon.userData.baseY)||1.2)*height;
       const mat=g.userData.beaconMat;
       if(mat&&'emissiveIntensity' in mat)mat.emissiveIntensity=.6*(1+p*.9);
       return p;
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
       group.traverse(node=>{node.layers.set(BOT_LAYER);node.userData.objective=true;node.userData.noCameraOcclusion=true;node.renderOrder=90;});
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
        const authoredNode=arena.nodes?.find(entry=>String(entry.id)===key);
        const radius=Math.max(.5,Number(node.r??node.radius??authoredNode?.r??authoredNode?.radius)||6);
        let g=this.objectiveModels.get(key);
        if(!g){g=this.createObjectiveModel({...node,radius,owner,contested,progress},arena);styleFoundryObjective(g,node,arena);g.userData.cocsNode=true;this.objectiveModels.set(key,g);this.worldGroup?.add(g);}
        active.add(key);this.styleCocsModel(g,node);
        const color=contested?'#ffd166':owned?this.objectiveColor(owner,arena):(COCS_NODE_TINTS[archetype]??NEUTRAL);
        const progressColor=contested?'#ffd166':capturing===0||capturing===1?this.objectiveColor(capturing,arena):'#eafff5';
        g.position.set(Number(node.x)||0,Number.isFinite(node.y)?node.y:(arena.terrain?.height?.(Number(node.x)||0,Number(node.z)||0)??authoredNode?.y??0),Number(node.z)||0);
        for(const mat of [g.userData.baseMat,g.userData.areaMat,g.userData.beaconMat]){mat.color.set(color);mat.emissive?.set(color);}
        g.userData.progressMat.color.set(progressColor);g.userData.progressMat.emissive?.set(progressColor);
        g.userData.progressMat.opacity=progress>0?1:0;g.userData.progressMat.transparent=true;
        if(g.userData.progressValue!==progress){
         if(software){g.userData.progress.geometry.dispose();g.userData.progress.geometry=new T.RingGeometry(Math.max(.1,radius-.2),radius+.2,32,1,0,Math.PI*2*progress/100);}
         else g.userData.progress.geometry.setDrawRange(0,Math.ceil(progress/100*32)*6);
         g.userData.progressValue=progress;
        }
        g.userData.progress.visible=progress>0;
        this._applyBeaconProgress(g,progress);
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
       updateLatticeWorld(this,match,arena);
      }
        updateObjectives(match,arena=MAPS[0]){const input=match?.objectives??match?.objectiveState;if(input?.kind==='cocs'){this.updateCocsObjectives(match,arena);return;}clearLatticeWorld(this);if(!input||!['koth','domination','assault','payload','extraction'].includes(input.kind)){this.clearObjectiveMarkers();return;}this.objectiveModels??=new Map();const active=new Set(),reduced=this.reduced(),software=this.renderer?.isSoftware===true,assaultActive=input.kind==='assault'&&Number.isFinite(input.active)?input.active:-1;for(const [zoneIndex,zone] of (input.kind==='extraction'?[{id:'extract',x:input.extract?.x,z:input.extract?.z,radius:input.escortRadius??6,progress:input.captureSeconds>0?Math.max(0,Math.min(100,(Number(input.progress)||0)/Number(input.captureSeconds)*100)):0,owner:Number.isInteger(input.escortTeam)?input.escortTeam:null,captureTeam:null,contested:false}]:input.zones||[]).entries()){if(!zone)continue;const key=String(zone.id??active.size),p=pointOf(zone),owner=zone.contested?'contested':zone.owner,capture=zone.captureTeam??zone.owner,progress=Math.max(0,Math.min(100,Number(zone.progress)||0)),radius=Math.max(.8,Number(zone.radius)||3.5);let g=this.objectiveModels.get(key);if(!g){g=this.createObjectiveModel(zone,arena);this.objectiveModels.set(key,g);this.worldGroup?.add(g);}active.add(key);const color=zone.contested?'#ffd166':this.objectiveColor(owner,arena),progressColor=zone.contested?'#ffd166':this.objectiveColor(capture,arena);g.position.set(p.x||0,p.y||0,p.z||0);g.userData.baseMat.color.set(color);g.userData.baseMat.emissive.set(color);g.userData.areaMat.color.set(color);g.userData.areaMat.emissive.set(color);g.userData.beaconMat.color.set(color);g.userData.beaconMat.emissive.set(color);g.userData.progressMat.color.set(progressColor);g.userData.progressMat.emissive.set(progressColor);g.userData.progressMat.opacity=progress>0?1:0;g.userData.progressMat.transparent=true;if(g.userData.radius!==radius){g.userData.area.geometry.dispose();g.userData.area.geometry=new T.CylinderGeometry(radius,radius,.035,32);g.userData.base.geometry.dispose();g.userData.base.geometry=new T.TorusGeometry(radius,.11,6,32);g.userData.progress.geometry.dispose();g.userData.progress.geometry=software?new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progress/100):new T.RingGeometry(radius-.2,radius+.2,32);if(!software)g.userData.progress.geometry.setDrawRange(0,Math.ceil(progress/100*32)*6);g.userData.radius=radius;}if(g.userData.progressValue!==progress){if(software){g.userData.progress.geometry.dispose();g.userData.progress.geometry=new T.RingGeometry(radius-.2,radius+.2,32,1,0,Math.PI*2*progress/100);}else g.userData.progress.geometry.setDrawRange(0,Math.ceil(progress/100*32)*6);g.userData.progressValue=progress;}g.userData.progress.visible=progress>0;this._applyBeaconProgress(g,progress);g.userData.identifier=String(zone.id??'zone');g.userData.emblem.material=g.userData.progressMat;const sectorActive=input.kind==='assault'&&zoneIndex===assaultActive,sectorDim=input.kind==='assault'&&!sectorActive;g.userData.assaultActive=sectorActive;if(input.kind==='assault'){g.userData.areaMat.opacity=sectorDim?.16:1;g.userData.areaMat.transparent=true;g.userData.baseMat.opacity=sectorDim?.32:1;g.userData.baseMat.transparent=true;g.userData.areaMat.emissiveIntensity=sectorActive?1.9:sectorDim?.3:1.25;g.userData.baseMat.emissiveIntensity=sectorActive?2:sectorDim?.35:1.25;if(!g.userData.assaultLabel&&typeof document!=='undefined'&&typeof document.createElement==='function'){const assaultLabel=textLabel(g,String(zone.id??'sector').toUpperCase(),0,2.7,0,.5,sectorActive?'#ffffff':'#95a3ac');assaultLabel.userData.objective=true;assaultLabel.userData.noCameraOcclusion=true;g.userData.assaultLabel=assaultLabel;}if(g.userData.assaultLabel)g.userData.assaultLabel.visible=sectorActive;}g.scale.y=reduced?1:sectorActive?1.04+.1*Math.sin((match.time||0)*5):sectorDim?1:zone.contested?1.05+.09*Math.sin((match.time||0)*6+(zone.id?.length||0)):1+.06*Math.sin((match.time||0)*4+(zone.id?.length||0));}for(const [key,g] of this.objectiveModels)if(!active.has(key)){this.worldGroup?.remove(g);this.disposeObject(g);this.objectiveModels.delete(key);}}
     // LATTICE depot loaners spawn mid-match (`spawnDepotVehicle`), long after
     // `setMatch` built the opening fleet. Rebuild only when the live roster and
     // the model map disagree (a missing model, or a stale one), so an unchanged
     // frame never re-syncs, rebuilds or disposes.
     _syncVehicleRoster(match){
      const vehicles=match?.vehicles||[],models=this.vehicleModels;
      if(typeof models?.has!=='function'){this.syncVehicles(match);return true;}
      let live=0;
      for(const vehicle of vehicles)if(vehicle&&models.has(vehicle.id))live++;
      if(live===vehicles.length&&models.size===live)return false;
      this.syncVehicles(match);return true;
     }
     updateVehicleModels(match){this._syncVehicleRoster(match);const reduced=this.reduced(),now=typeof performance!=='undefined'?performance.now():0;for(const vehicle of match.vehicles||[]){const model=this.vehicleModels?.get(vehicle.id);if(!model)continue;const p=vehicle.position||vehicle,x=p.x??0,y=p.y??0,z=p.z??0,yaw=vehicle.yaw??vehicle.heading??0,health=vehicle.health??1,respawn=vehicle.respawnTimer??0,vehiclePres=this._interpEnabled?this._presentVehicle(vehicle.id):null;model.visible=health>0&&respawn<=0;model.position.set(x,y,z);model.rotation.y=yaw;model.rotation.z=vehicle.roll??0;model.rotation.x=vehicle.pitchBody??vehicle.pitch??0;if(vehiclePres&&!vehiclePres.snapped){model.position.set(vehiclePres.x,vehiclePres.y,vehiclePres.z);model.rotation.y=vehiclePres.yaw;}const speed=Math.hypot(vehicle.vx??0,vehicle.vz??0),stamp=Number.isFinite(match.time)?match.time:now/1000,dt=Math.max(0,Math.min(.1,stamp-(model.userData.spinTime??stamp)));model.userData.spinTime=stamp;const odometer=(model.userData.odometer??0)+speed*dt;model.userData.odometer=odometer;for(const wheel of model.userData.wheels||[])wheel.rotation.x=odometer/.42;const turret=model.userData.turret;if(turret)turret.rotation.y=Number.isFinite(vehicle.turretYaw)?vehicle.turretYaw:0;const heat=vehicle.heat??0,flash=(model.userData.flashUntil??0)>now;for(const gun of model.userData.guns||[]){gun.mount.scale.setScalar(1+heat*.08);gun.flash.visible=!reduced&&flash;}if(!reduced&&(vehicle.boosting===true||((vehicle.boostCooldown??0)>0&&speed>11)||(vehicle.effects?.turbo>0))){if(stamp-(model.userData.lastExhaust??0)>=.04){model.userData.lastExhaust=stamp;this.effectPool??=new EffectPool(this.scene);const backDist=1.35,exX=x+Math.sin(yaw)*backDist,exY=y+.32,exZ=z+Math.cos(yaw)*backDist;this.effectPool.add({pos:V(exX,exY,exZ),color:(vehicle.effects?.turbo>0)?'#ff6622':'#00e5ff',endColor:(vehicle.effects?.turbo>0)?'#ff2200':'#0055ff',fade:'smooth',damping:1.2,size:.14,life:.22,expand:1.5,velocity:V(Math.sin(yaw)*2.5+(Math.random()-.5)*.4,Math.random()*.3,Math.cos(yaw)*2.5+(Math.random()-.5)*.4)});}}
   // Damaged-vehicle readability: below ~40% health a pooled smoke plume and
   // occasional sparks mark the wreck before it dies. Quality-scaled, WebGL
   // only and skipped under reduced motion, like the other pooled effects.
   const maxHealth=Number(vehicle.maxHealth)||0,healthFraction=maxHealth>0?health/maxHealth:(health<=1?health:1);
   if(!reduced&&healthFraction>0&&healthFraction<=.4&&this.renderer?.isSoftware!==true){
    const effectScale=Math.max(.2,Math.min(1.4,this._quality().particles||1)),noseX=x+Math.sin(yaw)*.55,noseZ=z+Math.cos(yaw)*.55;
    if(stamp-(model.userData.damageSmokeAt??-Infinity)>=.24){
     model.userData.damageSmokeAt=stamp;this.effectPool??=new EffectPool(this.scene);
     this.effectPool.add({pos:V(noseX,y+.6,noseZ),color:'#3d3a36',endColor:'#141210',fade:'exp',damping:.9,size:.18+.08*effectScale,life:.85,expand:.5,velocity:V((Math.random()-.5)*.5,.9+Math.random()*.7,(Math.random()-.5)*.5)});
    }
    if(stamp-(model.userData.damageSparkAt??-Infinity)>=.55){
     model.userData.damageSparkAt=stamp;this.effectPool??=new EffectPool(this.scene);
     const sparks=Math.max(1,Math.round(3*effectScale));
     for(let i=0;i<sparks;i++)this.effectPool.add({pos:V(noseX+(Math.random()-.5)*.7,y+.5,noseZ+(Math.random()-.5)*.7),color:'#ffcf7a',endColor:'#7a2200',fade:'exp',damping:1.6,gravity:8,size:.05,life:.4,additive:true,velocity:V((Math.random()-.5)*3.2,Math.random()*2+.5,(Math.random()-.5)*3.2)});
    }
   }
  }}
     // Riders on a live zipline get a pooled carriage (pulley + yoke) and a
     // reduced-motion-aware spark/wind trail. Presentation only: the pose comes
     // from the authoritative actor, so prediction and resync need no state.
     updateZipRides(match,delta,reduced){const actors=match?.actors;if(!Array.isArray(actors))return;const rides=this.zipCarriages??=new Map(),active=this._zipActive??=new Set();active.clear();const particles=Math.max(.2,Math.min(1.4,this._quality?.().particles??1));for(const a of actors){const ride=a?.zipRide;if(!ride)continue;active.add(a.id);let model=rides.get(a.id);if(!model){model=this._buildZipCarriage();this.scene.add(model);rides.set(a.id,model);model.userData.sparkAt=-Infinity;}const yaw=Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0),x=a.x||0,y=a.y||0,z=a.z||0,fx=-Math.sin(yaw),fz=-Math.cos(yaw);model.position.set(x+fx*.32,y+ZIP_CABLE_HANDLE+.06,z+fz*.32);model.rotation.y=yaw;if(reduced)continue;const time=Number.isFinite(match.time)?match.time:0;if(time-model.userData.sparkAt<ZIP_SPARK_INTERVAL)continue;model.userData.sparkAt=time;this.effectPool??=new EffectPool(this.scene);const speed=Math.max(1,Number(ride.speed)||9),back=.55,sx=x-Math.sin(yaw)*back,sz=z-Math.cos(yaw)*back,count=Math.max(1,Math.round(particles*2));for(let i=0;i<count;i++)this.effectPool.add({from:{x:sx,y:y+.5+i*.2,z:sz},to:{x:sx-Math.sin(yaw)*Math.min(3.2,speed*.24),y:y+.5+i*.2,z:sz-Math.cos(yaw)*Math.min(3.2,speed*.24)},color:'#d8f2ff',life:.09,size:.02,additive:true});this.effectPool.add({pos:V(sx,y+.32,sz),color:'#ffe3a8',endColor:'#8a4a12',fade:'exp',damping:1.5,gravity:3,size:.05,life:.22,velocity:V((Math.random()-.5)*2,(Math.random()-.2)*1.8,(Math.random()-.5)*2)});}for(const [id,model] of rides)if(!active.has(id)){this.scene.remove(model);this.disposeObject(model);rides.delete(id);}}
     _buildZipCarriage(){const g=new T.Group(),metal=material('#39474f',.7,.4),brass=material('#e7b55b',.5,.3,true),wheel=cylinder(g,.075,.075,.05,0,0,0,brass,10),yoke=box(g,.05,.42,.05,0,-.24,0,metal);wheel.rotation.z=Math.PI/2;box(g,.3,.05,.05,0,-.46,0,metal);yoke.userData.zipYoke=true;return g;}
     syncVehicles(match){this.vehicleModels??=new Map();const assets=this.modelAssets??=new ModelAssets();const active=new Set((match.vehicles||[]).map(vehicle=>vehicle.id));for(const [id,model] of this.vehicleModels)if(!active.has(id)){this.scene.remove(model);this.disposeObject(model);this.vehicleModels.delete(id);}for(const vehicle of match.vehicles||[]){if(this.vehicleModels.has(vehicle.id))continue;const model=vehicleModel(vehicle.kind,assets,this.renderer?.isSoftware===true);this.vehicleModels.set(vehicle.id,model);this.scene.add(model);}this._trackAssets(assets);}
    _trackAssets(assets=this.modelAssets){if(!assets)return;const shared=this.sharedResources??=new Set();for(const resource of assets.resources)shared.add(resource);}
    disposeObject(o){if(!o?.traverse)return;const shared=this.renderResources,modelShared=this.sharedResources,geometries=new Set(),materials=new Set(),textures=new Set();o.traverse(n=>{if(n.geometry&&!shared?.has(n.geometry)&&!modelShared?.has(n.geometry))geometries.add(n.geometry);if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])if(!shared?.has(m)&&!modelShared?.has(m)){materials.add(m);for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap','bumpMap','displacementMap','envMap','lightMap','specularMap','gradientMap'])if(m[key]&&!m[key].userData?.surfaceKind&&!m[key].userData?.mothShared)textures.add(m[key]);}});for(const r of [...geometries,...materials,...textures])r.dispose();}
   effect(e){if(!e)return;this.effectPool??=new EffectPool(this.scene);this.feedback??=new WeaponFeedback();const reduced=this.reduced(),info=weaponInfo(e.weapon??0);
   if(e.type==='death'){this.spawnDeath(e,reduced);if(this.killcamEnabled!==false&&!reduced&&e.pos&&(e.actor===this.playerId||this.spectator===true)){const focus={x:e.pos.x||0,y:e.pos.y||0,z:e.pos.z||0},killerModel=e.killer!=null?this.actorModels?.get(e.killer):null,killerPos=killerModel?.position;this._killcam={start:Number.isFinite(e.time)?e.time:0,duration:KILLCAM_DURATION,focus,killer:killerPos?{x:killerPos.x,y:killerPos.y,z:killerPos.z}:null,killerId:Number.isInteger(e.killer)?e.killer:null,seed:((Number.isFinite(e.seed)?e.seed:(e.actor??0)*7)>>>0)||1};}}
    // A local melee swing is presentation-only: the sim owns the hit, the view
    // owns the weapon arc.
    if(e.type==='melee'&&e.actor===this.playerId&&!reduced)this.meleeSwing({duration:.22,seed:Number.isFinite(e.id)?e.id:0});
     const actorModel=this.actorModels?.get(e.actor);
     if(!e.pos&&(e.type.startsWith('flag-')||e.type==='capture')&&actorModel)e={...e,pos:actorModel.position.clone().add(V(0,1,0))};
      // Change only the visual origin; authoritative hit endpoints and camera aim stay untouched.
       if(e.from&&(e.type==='shot'||e.type==='launch')){
        const local=e.actor===this.playerId,weapon=local?(this.hands?.visible?this.firstPerson:null):actorModel?.userData.weapon;
        if(weapon?.userData.type===e.weapon&&weapon.userData.muzzle){
         const muzzle=weapon.userData.muzzle.getWorldPosition(V()),twinSide=e.alt===true&&altSpecFor(e.weapon)?.id==='twin'?V(Math.abs(Number(e.pellet)||0)%2?-1:1,0,0).applyQuaternion(weapon.getWorldQuaternion(new T.Quaternion())).multiplyScalar(.062):null;
         if(twinSide)muzzle.add(twinSide);
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
          e={...e,from:this.camera.position.clone().addScaledVector(forward,depth),muzzleFrom:muzzle,...(twinSide?{muzzleSide:twinSide}:{})};
         }else e={...e,from:muzzle,muzzleFrom:muzzle,...(twinSide?{muzzleSide:twinSide}:{})};
        }
       }
     if(e.type==='shot'||e.type==='vehicle-shot'||e.type==='launch'||e.type==='dash')this.shotEffect(e,info,reduced);
       if(e.type==='shot'&&e.actor===this.playerId&&e.muzzleFrom&&!reduced)this._muzzleSmoke(e.muzzleFrom,((Number.isFinite(e.id)?e.id:0)*31+(e.weapon??0)*17)>>>0);
      if(['explosion','death','power','powerup','spawn','jam','flag-pickup','flag-drop','flag-return','capture','vehicle-destroyed'].includes(e.type)){const color=e.type==='explosion'?info.color:e.type==='vehicle-destroyed'?'#ff9944':e.type==='jam'?'#c99aff':e.type==='powerup'?'#ffcf70':e.type.startsWith('flag')||e.type==='capture'?(teamPresentation(e.team,this.display?.teamPalette)?.color??NEUTRAL):e.type==='death'?(CHARACTERS.find(c=>c.id===e.character)?.color??'#fff2ce'):'#74f4de';const impact=info.feel?.impactVisual,particleScale=this._particleScale(),count=(e.type==='death'||e.type==='vehicle-destroyed')&&!reduced?Math.max(1,Math.round(8*particleScale)):1,size=e.type==='death'?.12:e.type==='vehicle-destroyed'?.22:impact==='wide'?.42:impact==='burst'?.34:impact==='ring'?.22:.3;if(e.pos)for(let i=0;i<count;i++)this.effectPool.add({pos:e.pos,color,endColor:e.type==='vehicle-destroyed'?'#441800':e.type==='death'?'#553311':null,fade:'smooth',size,life:e.type==='death'?.5:e.type==='vehicle-destroyed'?.65:impact==='ring'?.4:.3,expand:reduced||e.type==='death'?0:impact==='ring'?1.5:3,wireframe:e.type==='power'||e.type==='powerup'||e.type==='spawn',velocity:(e.type==='death'||e.type==='vehicle-destroyed')&&!reduced?V((Math.random()-.5)*5,Math.random()*4+1,(Math.random()-.5)*5):null});if(e.type==='spawn'&&e.pos)this.effectPool.add({from:{x:e.pos.x,y:e.pos.y,z:e.pos.z},to:{x:e.pos.x,y:(e.pos.y||0)+2.2,z:e.pos.z},color,life:.4,size:.05,additive:true});if(!reduced&&e.pos){if(e.type==='spawn')this._spawnMothSprite('arc-burst',e.pos,{size:1.6,opacity:.55,life:.42,slots:3});else if(e.type==='capture'||e.type==='zone-capture')this._mothFx('effect-capture-ring','arc-burst',e.pos,{size:2.4,opacity:.65,life:.5,slots:3});}}
        if(e.type==='explosion'||e.type==='vehicle-destroyed'){const w=e.weapon??1,fragments=this._quality().particles;if(e.type==='vehicle-destroyed'){if(!reduced)for(let i=0;i<Math.max(1,Math.round(8*fragments));i++)this.effectPool.add({pos:e.pos,color:'#ff9944',endColor:'#331100',fade:'smooth',damping:1.5,gravity:9.8,spin:V((Math.random()-.5)*8,(Math.random()-.5)*8,(Math.random()-.5)*8),size:.14,life:.6,velocity:V((Math.random()-.5)*10,Math.random()*6+2,(Math.random()-.5)*10)});if(e.pos)this.breakPropsAt(e.pos,{radius:5.5,amount:60,serial:(e.id??0)+1,reduced});}else if(w===4){this.effectPool.add({pos:e.pos,color:'#bff4ff',endColor:'#1155aa',fade:'smooth',size:.3,life:.35,expand:reduced?0:1.8});this.effectPool.add({pos:e.pos,color:'#72cfff',endColor:'#002266',fade:'smooth',size:.5,life:.42,expand:reduced?0:2.4});}else if(w===5){if(!reduced)for(let i=0;i<Math.max(1,Math.round(7*fragments));i++)this.effectPool.add({pos:e.pos,color:'#ffb27a',endColor:'#661100',fade:'exp',damping:1.8,gravity:8,spin:V((Math.random()-.5)*6,(Math.random()-.5)*6,(Math.random()-.5)*6),size:.06,life:.5,velocity:V((Math.random()-.5)*9,Math.random()*6,(Math.random()-.5)*9),wireframe:true});}else if(w===1&&!reduced){for(let i=0;i<Math.max(1,Math.round(6*fragments));i++)this.effectPool.add({pos:e.pos,color:'#ffcf9a',endColor:'#ff3300',fade:'smooth',damping:1.6,gravity:9.8,spin:V((Math.random()-.5)*5,(Math.random()-.5)*5,(Math.random()-.5)*5),size:.07,life:.45,velocity:V((Math.random()-.5)*8,Math.random()*5,(Math.random()-.5)*8)});}
         // Blasts shatter nearby crates/barrels. Presentation-only and pooled.
         if(e.pos&&!reduced)this._mothFx('effect-explosion','arc-burst',e.pos,{size:e.type==='vehicle-destroyed'?4.4:3,opacity:.8,life:.5,grow:.6,slots:3});
         if(e.pos&&e.type==='explosion')this.breakPropsAt(e.pos,{radius:w===4?3.4:w===5?4.6:4,amount:w===4?60:45,serial:(e.id??0)+1,reduced});
         // Scorch stays under reduced motion; the light pulse and smoke do not.
         if(e.pos)this._spawnScorchDecal(e.pos,reduced,e.type==='vehicle-destroyed'?1.1:w===5?1.05:.9,(e.id??0)+1);
         this._explosionKit(e.pos,info.color,reduced,(e.id??0)+3,e.type==='vehicle-destroyed'?1.3:1);}
      // Alt-fire projectile beats: keyed visuals from `launch`, burst on the
      // matching `explosion`. Presentation only; the sim owns projectile state.
      if(e.type==='launch'&&(e.alt===true||e.altId!=null))this._altLaunch(e,reduced);
      if(e.type==='explosion'&&(e.alt===true||e.altId!=null||this.altProjectiles))this._altExplosion(e,reduced);
     if(e.type==='shot'||e.type==='launch'){const until=performance.now()+(info.feel?.muzzle?.[1]??.06)*1000,model=this.actorModels?.get(e.actor);if(model)model.userData.flashUntil=until;if(e.actor===this.playerId){this.feedback.shot(e.weapon,e.time);this.flashUntil=until;}if(e.type==='shot'&&!reduced)this._ejectShell(e);}if(e.type==='vehicle-shot'){const model=this.vehicleModels?.get(e.vehicle);if(model)model.userData.flashUntil=performance.now()+45;if(e.actor===this.playerId&&e.barrel===0){this.feedback.shot(0,e.time);this.flashUntil=performance.now()+45;}}
       if(e.type==='shot')this._heatShot(e,this.actorModels?.get(e.actor));
       if((e.type==='shot'||e.type==='vehicle-shot')&&!reduced&&this.muzzleLights){const muzzleColor=e.type==='vehicle-shot'?'#ffd166':(e.alt===true?altSpecFor(e.weapon)?.tracer:null)||info.color,muzzleLife=info.feel?.muzzle?.[1]??.06;this.muzzleLights.flash(muzzleColor,e.muzzleFrom??e.from??e.pos,muzzleLife);}
       // Baked sprite accents: traversal teleports flash a portal ring at both
       // ends, and remote muzzle flashes reuse the spark impact sheet so distant
       // fire reads at range. Local fire keeps the viewmodel flash only.
       if(e.type==='teleport'||e.type==='teleporter')this.teleportEffect(e,reduced);
       if(e.type==='zipline'||e.type==='zipline-arrival'||e.type==='zipline-jump')this.ziplineEffect(e,reduced);
       if(e.type==='launcher'||e.type==='launcher-arrival'||e.type==='jump-pad')this.launchEffect(e,reduced);
       if((e.type==='shot'||e.type==='vehicle-shot')&&!reduced&&e.actor!==this.playerId){const muzzle=e.muzzleFrom??e.from;if(muzzle)this._spawnMothSprite('spark-impact',muzzle,{size:e.type==='vehicle-shot'?1.1:.55,opacity:.5,life:.16,slots:3});}
       if(e.type==='damage'){this.applyHitReaction(e,reduced);this._damageReadability(e,reduced);if(e.shieldBreak){const targetModel=this.actorModels?.get(e.actor),pos=targetModel?targetModel.position:e.pos;if(pos){if(!reduced)this._mothFx('effect-shield',null,{x:pos.x,y:(pos.y||0)+1,z:pos.z},{size:1.5,opacity:.6,life:.4,slots:3});const count=reduced?2:Math.max(4,Math.round(6*this._particleScale()));for(let i=0;i<count;i++)this.effectPool.add({pos:V(pos.x,pos.y+1,pos.z),color:'#70ffe6',endColor:'#104466',fade:'smooth',damping:1.4,gravity:7,spin:V((Math.random()-.5)*10,(Math.random()-.5)*10,(Math.random()-.5)*10),size:.12,life:.32,wireframe:true,velocity:!reduced?V((Math.random()-.5)*5,Math.random()*3+1,(Math.random()-.5)*5):null});}}}
       if(e.type==='deployable'||e.type==='deployable-fire'||e.type==='deployable-expire'||e.type==='deployable-destroyed')this._deployableEvent(e,reduced);
      if(e.type==='mender-heal'&&!reduced)this._mothFx('effect-heal',null,{x:e.x||0,y:(e.y||0)+1,z:e.z||0},{size:Math.max(2,Number(e.radius)||3),opacity:.5,life:.6,slots:3});
       if(e.type==='phalanx-shield'&&!reduced)this._mothFx('effect-shield',null,{x:e.x||0,y:(e.y||0)+1,z:e.z||0},{size:Math.max(2,Number(e.radius)||3),opacity:.55,life:.5,slots:3});
       if(e.type==='pickup'&&!reduced&&['health','megahealth'].includes(e.kind)&&actorModel)this._mothFx('effect-heal',null,actorModel.position,{size:1.1,opacity:.45,life:.4,slots:3});
       if(e.type==='pickup'&&!reduced&&e.kind==='armor'&&actorModel)this._mothFx('effect-shield',null,actorModel.position,{size:1.1,opacity:.45,life:.4,slots:3});
       // Weapon/ammo and power pickups get the same activation read as health
       // and armour: a pooled burst in the pickup's own colour. WebGL only, so
       // the CPU renderer's frame stays byte-identical.
       if(e.type==='pickup'&&!reduced&&actorModel&&!['health','megahealth','armor'].includes(e.kind)&&this.renderer?.isSoftware!==true){
        const color=PICKUP_COLORS[e.kind]||'#8ad9d3',baseX=actorModel.position.x,baseY=(actorModel.position.y||0)+1,baseZ=actorModel.position.z,scale=Math.max(.2,Math.min(1.4,this._quality().particles||1));
        this.effectPool.add({pos:V(baseX,baseY,baseZ),color,endColor:'#0a1d24',fade:'smooth',size:.26,life:.34,expand:1.8+scale});
        const count=Math.max(2,Math.round(5*scale));
        for(let i=0;i<count;i++){const a=(i/count)*Math.PI*2;
         this.effectPool.add({pos:V(baseX,baseY,baseZ),color,endColor:'#0a1d24',fade:'smooth',life:.3,size:.07,velocity:V(Math.cos(a)*1.6,(Math.random()-.35)*1.4,Math.sin(a)*1.6)});}
       }
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
   shotEffect(e,info,reduced){this.effectPool??=new EffectPool(this.scene);const from=e.from,to=e.to??e.pos,weapon=e.weapon??0,feel=info.feel||{},color=e.type==='vehicle-shot'?'#ffd166':(info.color||'#c2ffea'),tracerScale=this._quality().tracers,tracer=feel.tracer||[.085,.055],altSpec=e.alt===true||e.altId!=null?altSpecFor(weapon):null;
    // Alt-fire hitscan styles (three-fan salvo, slug beam, pierce overload,
    // chain arcs, twin/double side pairs) all live in one branch so the base
    // per-weapon tracers stay byte-for-byte unchanged.
    if(altSpec)return this._altShotEffect(e,altSpec,from,to,reduced);
    if(e.type==='dash'){if(from&&to)this.effectPool.add({from,to,color:'#c99aff',life:.12,size:.08});return;}
    if(e.type==='launch'){if(to){this.effectPool.add({pos:to,color,size:(feel.muzzle?.[0]||.12)*1.5,life:feel.muzzle?.[1]||.09});this.effectPool.add({pos:to,color:'#ffffff',size:.06,life:.08});}return;}
      if(e.type==='vehicle-shot'){if(from&&to){this.effectPool.add({from,to,color,life:.08,size:.06*tracerScale,additive:true});this.effectPool.add({pos:to,color:'#fff2ce',size:.09*tracerScale,life:.12,expand:reduced?0:.3,additive:true});}return;}
     // A trace whose visual origin was clamped behind a close wall (or that is
     // simply shorter than ~5cm) keeps its impact but drops the backwards line.
     if(e.suppressTrace){if(to)this.impact(weapon,to,color,reduced,e.hit,from);return;}
     if(!from||!to)return;
     {const dx=(to.x||0)-(from.x||0),dy=(to.y||0)-(from.y||0),dz=(to.z||0)-(from.z||0);if(dx*dx+dy*dy+dz*dz<.0025){this.impact(weapon,to,color,reduced,e.hit,from);return;}}
    if(weapon===2&&this.railPool){this.railPool.spawn(from,to,color,reduced,tracerScale);this.railImpact(to,color,reduced);return;}
    if(weapon===6){this.lightning(from,to,color,reduced,tracerScale);this.impact(weapon,to,color,reduced,e.hit,from);return;}
     if(weapon===3||weapon===7){this.effectPool.add({from,to,color,life:.06,size:(weapon===7?.055:.04)*tracerScale,additive:true});this.impact(weapon,to,color,reduced,e.hit,from);return;}
     if(weapon===8){this.effectPool.add({from,to,color,life:.14,size:.05*tracerScale,additive:true});this.effectPool.add({from,to,color:'#ffffff',life:.06,size:.022*tracerScale,additive:true});this.impact(weapon,to,color,reduced,e.hit,from);return;}
     if(weapon===9){this.effectPool.add({from,to,color,life:.05,size:.035*tracerScale,additive:true});this.impact(weapon,to,color,reduced,e.hit,from);return;}
     this.effectPool.add({from,to,color,life:tracer[0],size:tracer[1]*tracerScale,additive:true});this.effectPool.add({from,to,color:'#ffffff',life:tracer[0]*.6,size:Math.max(.022,tracer[1]*.4*tracerScale),additive:true});this.impact(weapon,to,color,reduced,e.hit,from);
   }
   lightning(from,to,color,reduced,widthScale=1){const segments=reduced?5:9,width=Math.max(.2,Math.min(2.5,Number(widthScale)||1)),dx=(to.x-from.x)/segments,dy=(to.y-from.y)/segments,dz=(to.z-from.z)/segments,amp=reduced?.05:.16;let px=from.x,py=from.y,pz=from.z;for(let i=0;i<segments;i++){const last=i===segments-1,jitter=last?0:amp,ox=(Math.random()-.5)*jitter,oy=(Math.random()-.5)*jitter,oz=(Math.random()-.5)*jitter,nx=px+dx+ox,ny=py+dy+oy,nz=pz+dz+oz;this.effectPool.add({from:{x:px,y:py,z:pz},to:{x:nx,y:ny,z:nz},color,life:.07,size:.03*width});this.effectPool.add({from:{x:px,y:py,z:pz},to:{x:nx,y:ny,z:nz},color:'#ffffff',life:.04,size:.012*width});px=nx;py=ny;pz=nz;}}
    railImpact(pos,color,reduced){this.effectPool.add({pos,color:'#e8f7ff',size:.2,life:.22,expand:reduced?0:.7,wireframe:!reduced});this.effectPool.add({pos,color,size:.12,life:.3,expand:reduced?0:.4});if(!reduced)for(let i=0;i<6;i++)this.effectPool.add({pos,color:'#ffffff',endColor:color,fade:'smooth',damping:2.5,gravity:6,size:.05,life:.24,velocity:V((Math.random()-.5)*7,(Math.random()-.2)*7,(Math.random()-.5)*7)});}
        // Branch a world impact on the shot direction: steep downward rays are
        // floor hits (terrain only when the presentation support sample matches
        // the impact height), everything else reads as wall/prop. Actor hits
        // skip this and keep the legacy path.
        _impactStyle(pos,dir){
         if(!dir)return null;
         const ground=dir.y<-.6?this._groundSample()(pos.x||0,pos.z||0,pos.y??0):null;
         return impactSurfaceStyle(dir,{ground,y:pos.y});
        }
        // Terrain-floor dust: a couple of slow grey motes lifted by the hit.
        _impactDust(pos,style){
         for(let i=0;i<this._impactSparkCount(2);i++)this.effectPool.add({pos,color:style?.dust||'#8a7f6b',endColor:'#2b2925',fade:'smooth',size:.05,life:.42,expand:.18,gravity:.6,damping:1.4,startOpacity:.4,velocity:V((Math.random()-.5)*2.2,Math.random()*1.6,(Math.random()-.5)*2.2)});
        }
        // Sustained-fire muzzle smoke: the pooled explosion smoke recipe at a
        // smaller scale, emitted every Nth local shot by the tier cadence.
        _muzzleSmoke(muzzle,seed=0){
         if(!muzzle||this.reduced()===true)return null;
         const period=muzzleSmokePeriod(this._quality().particles,this._effectsScale??1,false);
         if(period<=0)return null;
         this._muzzleSmokeCount=(this._muzzleSmokeCount??0)+1;
         if(this._muzzleSmokeCount%period!==0)return null;
         this.effectPool??=new EffectPool(this.scene);
         return this.effectPool.add({pos:V(muzzle.x||0,muzzle.y||0,muzzle.z||0),color:'#4a4d52',endColor:'#14161a',fade:'smooth',size:.07,life:1+hashUnit(seed,1)*.5,expand:.2,gravity:-.3,damping:1.2,startOpacity:.22,velocity:V((hashUnit(seed,2)-.5)*.4,.35+hashUnit(seed,3)*.35,(hashUnit(seed,4)-.5)*.4)});
        }
        // `dir` is the shot direction: the decal lies on the surface the ray hit
        // so wall/ceiling impacts stop drawing a floating ground square. A
        // missing direction keeps the legacy ground-parallel stamp.
        _spawnImpactDecal(pos,reduced,weapon,dir=null,style=null){if(this.renderer?.isSoftware===true||!pos)return;const limits=this._quality();if(!limits.decals)return;this.decalPool??=new DecalPool(this.scene,limits.decals);const seed=((this._decalSerial=(this._decalSerial??0)+1)*131+(weapon|0)*17)>>>0;this.decalPool.spawn(pos,{color:reduced?'#201a15':style?.decal??'#171310',size:reduced?.24:.32,life:reduced?3.5:6,reduced,seed,dir});}
        // Blast scorch: a broad soot ring plus a denser core at the impact
        // point, grounded on the sampled support so a mid-air blast does not
        // leave a floating square. Reduced motion keeps the mark static.
        _spawnScorchDecal(pos,reduced,size=.9,seed=0){if(this.renderer?.isSoftware===true||!pos)return null;const limits=this._quality();if(!limits.decals)return null;this.decalPool??=new DecalPool(this.scene,limits.decals);const ground=this._groundSample()(pos.x||0,pos.z||0,pos.y??0),y=Number.isFinite(ground)&&ground<=(pos.y??0)+.45?ground:(pos.y||0);const markSeed=((this._decalSerial=(this._decalSerial??0)+1)*131+(seed|0)*17+7)>>>0;return this.decalPool.scorch({x:pos.x,y,z:pos.z},{color:reduced?'#1c1713':'#120e0b',size:reduced?size*.75:size,life:reduced?5:8,reduced,seed:markSeed});}
         impact(weapon,pos,color,reduced,hit,from=null){
          if(!pos)return;
          // The authoritative shot direction branches floor vs wall before any
          // accent spawns. Actor hits (`hit`) keep the legacy gore path; only
          // world surfaces pick a style.
          const dir=from?this._shotDir??=new T.Vector3():null;
          if(dir)dir.set((pos.x||0)-(from.x||0),(pos.y||0)-(from.y||0),(pos.z||0)-(from.z||0));
          const surface=hit?null:this._impactStyle(pos,dir),base=hit?'#fff2ce':color;
          this._spawnImpactDecal(pos,reduced,weapon,dir,surface);
          if(!reduced)this._spawnMothSprite('spark-impact',pos,{size:hit?.5:.34,opacity:.55,life:.24,slots:3});
          this.effectPool.add({pos,color:'#fff2ce',size:.055,life:.07,additive:true});
          if(!reduced)this.effectPool.add({from:{x:pos.x,y:pos.y,z:pos.z},to:{x:pos.x,y:(pos.y||0)+.3,z:pos.z},color:base,life:.1,size:.026,additive:true});
          if(surface?.terrain&&!reduced)this._impactDust(pos,surface);
          if(weapon===3||weapon===7){this.effectPool.add({pos,color:base,size:weapon===7?.13:.1,life:.14,expand:reduced?0:.5});if(!reduced)for(let i=0;i<this._impactSparkCount(4);i++)this.effectPool.add({pos,color:surface?.dust||'#6b7681',size:.045,life:.3,velocity:V((Math.random()-.5)*6,Math.random()*3,(Math.random()-.5)*6)});return;}
          if(weapon===6){this.effectPool.add({pos,color:'#dff6ff',size:.11,life:.14,expand:reduced?0:.6});if(!reduced)for(let i=0;i<this._impactSparkCount(5);i++)this.effectPool.add({pos,color,size:.04,life:.2,velocity:V((Math.random()-.5)*8,(Math.random()-.5)*8,(Math.random()-.5)*8),wireframe:true});return;}
          if(weapon===4){this.effectPool.add({pos,color,size:.14,life:.2,expand:reduced?0:1.1});this.effectPool.add({pos,color:'#ffffff',size:.07,life:.14});return;}
          this.effectPool.add({pos,color:base,size:hit?.09:.055,life:hit?.16:.1,expand:reduced?0:.25});
          if(!reduced&&surface?.wall)for(let i=0;i<this._impactSparkCount(2);i++)this.effectPool.add({pos,color:surface.spark,size:.03,life:.22,additive:true,velocity:V((Math.random()-.5)*4,Math.random()*2.6,(Math.random()-.5)*4)});
         }
  // ---- Alt-fire shot + projectile presentation (v8.6) ----------------------
  // Hitscan alt styles. The base `shotEffect` table is untouched: only events
  // tagged `alt`/`altId` route here. `muzzleSide` (twin) and `pellet` decide
  // side pairs; the rest fan from the tracer direction so the calls stay
  // camera-independent and testable.
  _altShotEffect(e,spec,from,to,reduced){
   const pool=this.effectPool,weapon=e.weapon??0,color=spec.tracer,tracerScale=Number(this._quality?.().tracers)||1;
   if(e.type==='launch'){
    if(to){pool.add({pos:to,color,size:.18,life:.14,expand:reduced?0:.35});pool.add({pos:to,color:'#ffffff',size:.07,life:.09});}
    return;
   }
   if(e.suppressTrace){if(to)this.impact(weapon,to,color,reduced,e.hit,from);return;}
   if(!from||!to)return;
   const dir=V((to.x||0)-(from.x||0),(to.y||0)-(from.y||0),(to.z||0)-(from.z||0)),length=dir.length()||1;
   dir.multiplyScalar(1/length);
   const side=V().crossVectors(dir,V(0,1,0));if(side.lengthSq()<1e-8)side.set(1,0,0);side.normalize();
   const shift=(base,k,along=side)=>({x:base.x+along.x*k,y:base.y+along.y*k,z:base.z+along.z*k});
   const stem=e.muzzleSide?shift(from,1,e.muzzleSide):from;
   const line=(a,b,thick,life=.1,coreColor='#ffffff')=>{pool.add({from:a,to:b,color,life,size:thick,additive:true});pool.add({from:a,to:b,color:coreColor,life:Math.min(life,.06),size:Math.max(.014,thick*.34),additive:true});};
   switch(spec.id){
    case 'salvo':{for(const k of [-1,0,1])line(shift(stem,k*.05),shift(to,k*.32),.03*tracerScale,.09);break;}
    case 'slug':{pool.add({from:stem,to,color:'#ffffff',life:.16,size:.13*tracerScale,additive:true});pool.add({from:stem,to,color,life:.1,size:.055*tracerScale,additive:true});break;}
    case 'overload':{
     if(this.railPool)this.railPool.spawn(stem,to,color,reduced,tracerScale);
     else pool.add({from:stem,to,color,life:.14,size:.16*tracerScale,additive:true});
     pool.add({from:to,to:shift(to,2.4,dir),color:'#ffffff',life:.1,size:.04*tracerScale,additive:true});
     this.railImpact(to,color,reduced);
     break;
    }
    case 'chain':{
     this.lightning(stem,to,color,reduced,tracerScale);
     for(const target of (Array.isArray(e.targets)?e.targets:[]).slice(0,4))if(target&&Number.isFinite(target.x))this.lightning(to,target,color,reduced,tracerScale);
     this.impact(weapon,to,color,reduced,e.hit,from);
     break;
    }
    case 'double':case 'twin':{
     const pellets=Number.isInteger(e.pellet)?[e.pellet]:[0,1];
     for(const index of pellets){const k=index%2?1:-1;line(shift(stem,k*.05),shift(to,k*.06),(spec.id==='twin'?.03:.045)*tracerScale,spec.id==='twin'?.08:.14);}
     this.impact(weapon,to,color,reduced,e.hit,from);
     break;
    }
    default:{line(from,to,.07*tracerScale,.09);this.impact(weapon,to,color,reduced,e.hit,from);break;}
   }
  }
  // The keyed projectile pool. Lazily created on the first alt projectile so a
  // match that never uses one allocates nothing; bounded and disposed with the
  // view either way.
  _altPool(){this.altProjectiles??=new AltProjectilePool(this.scene,Math.max(6,Math.min(16,Number(this.qualitySettings?.deaths)||12)));return this.altProjectiles;}
  _syncAltProjectiles(rockets,time,reduced){
   const rows=[];
   for(const [index,rocket] of (rockets||[]).entries()){
    const kind=altRocketKind(rocket);if(!kind)continue;
    const present=this._interpEnabled?this._presentRocket(index):null,position=present&&!present.snapped?present:rocket.pos;if(!position)continue;
    rows.push({id:rocket.id!=null?rocket.id:`#${index}`,kind,pos:{x:position.x||0,y:position.y||0,z:position.z||0},life:rocket.life,arm:rocket.arm,mine:rocket.mine===true});
   }
   if(!rows.length&&!this.altProjectiles)return null;
   const pool=this._altPool();
   pool.sync(rows,{time:Number.isFinite(time)?time:0,reduced:reduced===true});
   return pool;
  }
  // Local `launch` beat: spawn the keyed visual immediately (before the next
  // snapshot) and ping the sensor for a mine deploy.
  _altLaunch(e,reduced){
   const spec=altSpecFor(e.weapon??0),id=typeof e.altId==='string'?e.altId:spec?.id;
   if(!['cluster','mortar','mine','bomb'].includes(id))return null;
   const pos=e.from||e.pos||e.to;if(!pos)return null;
   const slot=this._altPool().spawn({key:e.projectile??e.id??null,kind:id,pos,arm:e.arm,life:e.life,mine:e.mine===true||id==='mine',time:Number.isFinite(e.time)?e.time:0});
   if(id==='mine'&&!reduced){const pool=this.telegraphPool??=new TelegraphPool(this.scene,20);pool.spawn({kind:'ring',pos,color:spec?.tracer||altProjectileColor(id),radius:.5,life:.5,grow:1.4,opacity:.55});}
   return slot;
  }
  // Explosion beat: release the matching keyed projectile (id or nearest) and
  // layer a kind-specific burst. Reduced motion keeps the flash, drops streaks.
  _altExplosion(e,reduced){
   const spec=altSpecFor(e.weapon??0),id=typeof e.altId==='string'?e.altId:spec?.kind==='projectile'?spec.id:null;
   const key=e.projectile??e.rocketId??e.altId??e.mineId??null;
   const removed=this.altProjectiles?this.altProjectiles.explode(key,e.pos||null):null;
   const kind=removed?.kind||(id&&['cluster','mortar','mine','bomb'].includes(id)?id:null);
   if(!kind)return null;
   const pos=e.pos||removed?.pos;if(!pos)return null;
   const color=altProjectileColor(kind),fx=this.effectPool??=new EffectPool(this.scene);
   if(kind==='cluster'){
    fx.add({pos,color,size:reduced?.22:.3,life:.22,expand:reduced?0:.9});
    fx.add({pos,color,size:.09,life:.45,velocity:reduced?null:V(0,1.4,-2.2)});
    if(!reduced)for(const k of [-1,1])fx.add({pos,color,size:.09,life:.45,velocity:V(k*3.4,.8,k*1.2)});
   }else if(kind==='mortar'){
    fx.add({pos,color,size:reduced?.24:.34,life:.28,expand:reduced?0:1.6});
    if(!reduced)fx.add({pos,color:'#ffffff',size:.08,life:.14});
   }else if(kind==='bomb'){
    fx.add({pos,color,size:reduced?.24:.32,life:.24,expand:reduced?0:1.2});
    if(!reduced)for(let i=0;i<6;i++){const a=i*Math.PI/3;fx.add({from:{x:pos.x||0,y:pos.y||0,z:pos.z||0},to:{x:(pos.x||0)+Math.cos(a)*2.2,y:(pos.y||0)+.5,z:(pos.z||0)+Math.sin(a)*2.2},color,life:.16,size:.03,additive:true});}
   }else{
    fx.add({pos,color,size:reduced?.2:.3,life:.3,expand:reduced?0:1.8});
    if(!reduced)fx.add({pos,color:'#dff6ff',size:.07,life:.14});
   }
   // Alt blasts share the same scorch + light/smoke kit as base explosions.
   this._spawnScorchDecal(pos,reduced,kind==='mortar'?1:.8,(e.id??0)+5);
   this._explosionKit(pos,color,reduced,(e.id??0)+7,1);
   return removed||{kind,key,pos};
  }
  // A presentation-space ground sample for the active match. Uses the host hook
  // when present and falls back to the pure spatial selector, matching the
  // actor alignment path. The returned closure is called for splash/scorch
  // grounding only; it never mutates the simulation.
  _groundSample(match=this._matchRef){
   const arena=match?.arena??MAPS.find(map=>map.id===(match?.mapId??this.mapId))??MAPS[0];
   return (x,z,referenceY)=>typeof this.characterGroundAt==='function'?this.characterGroundAt(x,z,referenceY,match):presentationSupportAt(x,z,arena,referenceY);
  }
  // Shared explosion kit: a few slow smoke motes from the existing pooled effect
  // path plus one pooled light pulse. No material, geometry or light is
  // allocated per blast, and reduced motion drops both (the scorch is stamped by
  // the caller and stays static). Returns how many items were spawned.
  _explosionKit(pos,color,reduced,seed=0,scale=1){
   if(!pos||reduced)return 0;
   this.effectPool??=new EffectPool(this.scene);
   const amount=Math.max(.6,Math.min(1.6,Number(scale)||1)),particleScale=this._particleScale();
   let spawned=0;
   for(let i=0;i<3;i++){
    this.effectPool.add({pos:V((pos.x||0)+(hashUnit(seed,i+1)-.5)*.6,(pos.y||0)+.3+hashUnit(seed,i+2)*.5,(pos.z||0)+(hashUnit(seed,i+3)-.5)*.6),color:'#2f2a26',endColor:'#0b0a09',fade:'smooth',size:.2*amount*particleScale,life:1.1+hashUnit(seed,i+4)*.5,expand:.22,gravity:-.35,damping:1.1,startOpacity:.28,velocity:V((hashUnit(seed,i+5)-.5)*.7,.5+hashUnit(seed,i+6)*.5,(hashUnit(seed,i+7)-.5)*.7)});
    spawned++;
   }
   if(this.muzzleLights){this.muzzleLights.flash(color||'#ffb066',pos,.24,4.2*amount);spawned++;}
   return spawned;
  }
  deathFx(){return this.deathPool??=new DeathPool(this.scene,this._quality().deaths,this._quality().splats);}
  spawnDeath(e,reduced){
   if(!e?.pos)return;
   const seed=Number.isFinite(e.seed)?e.seed>>>0:0;
   // The sim's authoritative style wins when present; the planner hashes one
   // when a debug/legacy caller omits it. The stored context carries the kill
   // direction so the lifecycle can orient the fall away from the shot.
   const plan=deathPlan({weapon:e.weapon,overkill:e.overkill,fall:e.fall===true,seed,actor:e.actor??0,style:e.style});
   (this.deathContext??=new Map()).set(e.actor,{plan,pos:e.pos,direction:e.direction??null,style:plan.style,seed,start:null});
   const pool=this.deathFx();
   pool.spawn(e.pos,{pieces:plan.pieces,force:plan.force,color:plan.color,reduced,seed,spin:plan.spin,splay:plan.splay});
   if(plan.gore>0){
    this.effectPool??=new EffectPool(this.scene);
    const count=reduced?Math.min(3,plan.gore):plan.gore,fire=plan.fire===true,energy=plan.energy===true;
    for(let i=0;i<count;i++)this.effectPool.add({pos:e.pos,color:plan.color,size:.045+hashUnit(seed,i,7)*.05,life:.55,velocity:V((hashUnit(seed,i,1)-.5)*7,hashUnit(seed,i,2)*5,(hashUnit(seed,i,3)-.5)*7)});
    // Fire styles trail embers; energy styles flash additive sparks. Both are
    // presentation-only accents on top of the pooled debris budget.
    if(fire&&!reduced)for(let i=0;i<Math.max(1,Math.round(count*.5));i++)this.effectPool.add({pos:e.pos,color:'#ffb27a',endColor:'#331100',fade:'exp',damping:1.6,gravity:4,size:.07,life:.5,additive:true,velocity:V((hashUnit(seed,i,11)-.5)*4,1+hashUnit(seed,i,12)*3,(hashUnit(seed,i,13)-.5)*4)});
    if(energy&&!reduced)for(let i=0;i<Math.max(1,Math.round(count*.4));i++)this.effectPool.add({pos:e.pos,color:'#bff4ff',size:.06,life:.35,additive:true,velocity:V((hashUnit(seed,i,21)-.5)*8,hashUnit(seed,i,22)*4,(hashUnit(seed,i,23)-.5)*8)});
   }
   if(e.fall!==true&&!plan.hideBody&&Number.isFinite(e.pos.y))pool.splat({x:e.pos.x,y:e.pos.y-1,z:e.pos.z},{color:plan.energy?'#20343d':'#570c0c',reduced,seed});
  }
  // ---- First-person melee swing ------------------------------------------
  // Deterministic ~220 ms arc layered on the freshly composed weapon pose:
  // a short wind-up, then a forward shove and diagonal chop. Triggered by the
  // local `melee` event (or the host calling `meleeSwing` on press). Reduced
  // motion snaps: no arc, any in-flight swing is dropped.
  meleeSwing({duration=.22,seed=0}={}){
   this._meleeSwing={t:0,duration:Math.max(.18,Math.min(.26,Number(duration)||.22)),seed:(Number(seed)||0)>>>0};
   return this._meleeSwing;
  }
  // Call once per frame after AdsController.compose; contributes only the
  // current frame's offset, so the composed pose stays the base.
  _applyMeleeSwing(delta,reduced){
   const swing=this._meleeSwing;if(!swing)return null;
   if(reduced||!this.hands){this._meleeSwing=null;return {phase:0,reduced:reduced===true};}
   swing.t+=Math.max(0,Math.min(.1,Number(delta)||0));
   const p=Math.min(1,swing.t/swing.duration),wind=p<.32?p/.32:1,drive=p<.32?0:Math.sin(((p-.32)/.68)*Math.PI);
   this.hands.position.z-=.1*drive-.045*wind;
   this.hands.position.y+=.03*drive-.02*wind;
   this.hands.rotateX(-.55*drive+.22*wind);
   this.hands.rotateZ((swing.seed%2?-1:1)*.4*drive);
   if(p>=1)this._meleeSwing=null;
   return {phase:p,wind,drive};
  }
  // ---- Ballistic shell casings -------------------------------------------
  // The casing leaves the viewmodel's right-side ejection port (local +x,
  // just below the sight line) with a deterministic fling. Energy weapons
  // (rail/plasma/lightning) throw no case; the CPU renderer, reduced motion and
  // remote shooters never allocate the pool.
  shellFx(){return this.shellPool??=new ShellPool(this.scene,this._quality().deaths);}
  _ejectShell(e){
   const weapon=Number.isInteger(e.weapon)?e.weapon:-1;
   if(weapon===2||weapon===4||weapon===6)return null;
   // Alt projectiles and the energy alts never throw a case; kinetic alts
   // (salvo/slug/double/twin) keep the ballistic casing.
   if(e?.alt===true){const spec=altSpecFor(weapon);if(!spec||spec.kind==='projectile'||spec.id==='overload'||spec.id==='chain')return null;}
   if(this.renderer?.isSoftware===true||!this.firstPerson||!this.hands?.visible||e.actor!==this.playerId)return null;
   const seed=((Number.isFinite(e.id)?e.id*31:0)+(weapon+1)*131)>>>0;
   this.hands.updateWorldMatrix(true,false);
   const pos=this._shellPos??=new T.Vector3(),vel=this._shellVel??=new T.Vector3(),quat=this._shellQuat??=new T.Quaternion();
   pos.set(.085,.02,-.05);this.hands.localToWorld(pos);
   this.hands.getWorldQuaternion(quat);
   vel.set(1,1.1,.15).applyQuaternion(quat).multiplyScalar(1.4+hashUnit(seed,1)*.5);
   const slot=this.shellFx().spawn(pos,{velocity:vel,color:'#d9b45b',seed,life:.85});
   // Optional casing foley, fired at the same ejection cadence as the case
   // itself. Guarded: audio implementations without the hook are untouched.
   const audio=this.audio??this.viewAudio;
   if(slot&&audio?.shellCasing){
    const rel=this._shellAudioRel??=new T.Vector3(),right=this._shellAudioRight??=new T.Vector3();
    rel.copy(pos);if(this.camera?.position)rel.sub(this.camera.position);
    right.set(1,0,0).applyQuaternion(this.camera?.quaternion??quat);
    audio.shellCasing(Math.max(-1,Math.min(1,rel.dot(right)/3)),seed,e.surface??e.material??null);
   }
   return slot;
  }
  // ---- Debug death hook ---------------------------------------------------
  // Test/screenshot-only: builds one deterministic corpse for an explicit
  // style/seed/direction without touching the authoritative simulation. The
  // resolved plan is returned so a harness can report what it rendered; normal
  // play never calls this and the vision is disposable.
  debugDeath({actor=null,character='chatgpt',style=null,weapon=0,overkill=0,fall=false,seed=0,direction=null,x=0,y=0,z=0,yaw=0,time=0,settle=true,reduced=this.reduced?.()===true,ragdoll=null}={}){
   const id=Number.isInteger(actor)?actor:-(1+((this._debugDeathSerial=(this._debugDeathSerial??0)+1)));
   const pos={x:Number(x)||0,y:Number(y)||0,z:Number(z)||0};
   const seedValue=Number.isFinite(Number(seed))?Number(seed):0;
   const plan=deathPlan({weapon:Number.isInteger(weapon)?weapon:0,overkill,fall:fall===true,seed:seedValue,actor:id,style:style??undefined});
   this.spawnDeath({type:'death',actor:id,character,pos,weapon:Number.isInteger(weapon)?weapon:0,overkill,fall:fall===true,seed:seedValue,direction:direction??null,style:plan.style},reduced);
   const model=robotModel(character,this.modelAssets??=new ModelAssets(),this.renderer?.isSoftware===true);
   this._addActorModel(model);
   (this._debugCorpses??=new Map()).set(id,model);
   while(this._debugCorpses.size>8){const [old,entry]=this._debugCorpses.entries().next().value;this._debugCorpses.delete(old);this.characterLifecycle?.release(entry);this.scene?.remove(entry);this.disposeObject(entry);}
   const body={id,x:pos.x,y:pos.y,z:pos.z,health:0,yaw:Number(yaw)||0,bodyYaw:Number(yaw)||0,deaths:0};
   const match={time:Number(time)||0,arena:MAPS.find(map=>map.id===this.mapId)??MAPS[0]};
   this.poseCorpse(model,body,match,{reduced,ragdoll});
   if(settle!==false)this.poseCorpse(model,body,{...match,time:(Number(time)||0)+fallDuration(plan)+.05},{reduced,ragdoll});
   return {id,model,plan,style:plan.style,direction:direction??null,position:{...pos},settled:settle!==false,ragdoll:Boolean(this.characterLifecycle?.records?.get(model)?.ragdoll)};
  }
  _clearDebugDeaths(){
   for(const model of this._debugCorpses?.values()??[]){this.characterLifecycle?.release(model);this.scene?.remove(model);this.disposeObject(model);}
   const count=this._debugCorpses?.size??0;this._debugCorpses?.clear();return count;
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
  // Applied after the actor sync each frame: feeds the rig's flinch channel
  // with the damage-scaled 0..1 strength, tips the model away from the shot and
  // re-applies the bounded knockback offset while the hit is live. The lean is
  // cleared when the 220 ms window expires so no stale tilt survives.
  _updateHitReactions(){
   if(!this.hitFlinch?.size)return 0;
   const now=typeof performance!=='undefined'?performance.now():0;let live=0;
   for(const [id,state] of this.hitFlinch){
    const model=this.actorModels?.get(id);
    if(state.until<=now){
     this.hitFlinch.delete(id);
     if(model&&!this.characterLifecycle?.ownsTransform(model)){model.rotation.x=0;model.rotation.z=0;model.userData.hitStrength=0;}
     continue;
    }
    live++;
    if(!model||this.characterLifecycle?.ownsTransform(model))continue;
    model.userData.hitUntil=Math.max(model.userData.hitUntil??0,state.until);
    model.userData.hitStrength=Math.max(0,Math.min(1,Number(state.strength)||0));
    const pushX=Number(state.pushX)||0,pushZ=Number(state.pushZ)||0,len=Math.hypot(pushX,pushZ);
    const lean=Math.min(.3,Math.max(0,Number(state.lean)||0)*.4+Math.min(1,Number(state.strength)||0)*.12);
    model.rotation.x=len>1e-6?-lean*pushZ/len:0;
    model.rotation.z=len>1e-6?lean*pushX/len:0;
    // Direction on the model data so the final living pass can pitch the rig
    // hit channel from the same impulse that carries the world-space lean.
    model.userData.hitDirX=len>1e-6?pushX/len:0;
    model.userData.hitDirZ=len>1e-6?pushZ/len:0;
    if(pushX||pushZ){model.position.x+=pushX;model.position.z+=pushZ;}
   }
   return live;
  }
  // Final living-only contact pass: after interpolation, styling, swaps and hit
  // pushes. Then the deterministic secondary pass advances springs for head lag
  // and antenna/backpack/fin/crest flex, and pitches the rig hit channel from
  // the live hit direction. Dead rigs are skipped by both passes.
  _alignLivingCharacters(match){
   const arena=match?.arena??MAPS.find(map=>map.id===match?.mapId)??MAPS[0];
   const sampleGround=(x,z,referenceY)=>typeof this.characterGroundAt==='function'
     ?this.characterGroundAt(x,z,referenceY,match)
     :presentationSupportAt(x,z,arena,referenceY);
   const reduced=typeof this.reduced==='function'?this.reduced()===true:this.reduced===true;
   const cheap=this.renderer?.isSoftware===true;
   // Secondary motion advances on the presentation clock carried by the match
   // snapshot. A rewind/seek contributes a zero-length step instead of replaying.
   const time=Number(match?.time);
   const dt=Number.isFinite(time)&&Number.isFinite(this._secondaryAt)&&time>=this._secondaryAt
     ?Math.max(0,Math.min(.1,time-this._secondaryAt)):0;
   if(Number.isFinite(time))this._secondaryAt=time;
   for(const actor of match?.actors??[]){
    const model=this.actorModels?.get(actor.id);
    if(!model||!model.visible||actor.health<=0||actor.vehicleId!=null)continue;
    if(this.characterLifecycle&&this.characterLifecycle.state(model)!=='alive')continue;
    alignLivingCharacter(model,{grounded:actor.grounded!==false,sampleGround});
    const speed=Math.hypot(Number(actor.vx)||0,Number(actor.vz)||0);
    applyLivingSecondary(model,{dt,reduced,cheap,speed,maxSpeed:Number(actor.moveSpeed)||8,hit:model.userData.hitStrength||0});
    const rig=model.userData.rig;
    if(rig){
      rig.setSliding(actor.sliding===true);
      rig.setHitDirection(model.userData.hitDirX||0,model.userData.hitDirZ||0,model.userData.hitStrength||0);
      rig.writeHitLean();
    }
   }
  }
  // Deployable sentry event beats, called from the `effect` dispatch. Spawn
  // rings, muzzle flashes/tracers and death smoke reuse the existing pooled
  // effects; every branch is suppressed under reduced motion so the sentry
  // itself stays a static model.
  _deployableEvent(e,reduced){
   const type=e?.type;
   if(reduced||!this.scene)return 0;
   const arena=this._matchRef?.arena||MAPS.find(map=>map.id===this._matchRef?.mapId)||MAPS[0];
   const sentry=this._matchRef?.deployables?.find?.(d=>d?.id===e.sentry);
   if(type==='deployable'){
    const pos={x:Number(e.x)||0,y:(Number(e.y)||0)+.08,z:Number(e.z)||0},color=this.objectiveColor(sentry?.team??null,arena);
    const pool=this.telegraphPool??=new TelegraphPool(this.scene,20);
    pool.spawn({kind:'ring',pos,color,radius:.6,life:.45,grow:1.1,opacity:.55});
    // Pooled fallback beats keep the cue readable when the baked Moth sheet is
    // unavailable (and on the CPU renderer, which has no sprite player).
    this.effectPool??=new EffectPool(this.scene);
    for(let i=0;i<3;i++)this.effectPool.add({pos:V(pos.x+(Math.random()-.5)*.4,pos.y+.2+i*.22,pos.z+(Math.random()-.5)*.4),color,size:.07,life:.34,wireframe:true,velocity:V((Math.random()-.5)*.6,1.2+Math.random()*.8,(Math.random()-.5)*.6)});
    this.effectPool.add({from:{x:pos.x,y:pos.y,z:pos.z},to:{x:pos.x,y:pos.y+1.9,z:pos.z},color,life:.4,size:.05,additive:true});
    this._mothFx('effect-deployable','arc-burst',pos,{size:1.5,opacity:.55,life:.4,grow:.5,slots:3});
    return 1;
   }
   if(type==='deployable-fire'){
    const base=this.deployableModels?.get(e.sentry)?.position,from=base?{x:base.x,y:base.y+.72,z:base.z}:(sentry?{x:Number(sentry.x)||0,y:(Number(sentry.y)||0)+.72,z:Number(sentry.z)||0}:null);
    const actor=this._matchRef?.actors?.find?.(a=>a?.id===e.target),target=this.actorModels?.get(e.target)?.position||(actor?{x:actor.x,y:actor.y,z:actor.z}:null);
    if(!from||!target)return 0;
    const color=this.objectiveColor(sentry?.team??null,arena);
    this.effectPool??=new EffectPool(this.scene);
    this.effectPool.add({from,to:{x:target.x||0,y:(target.y||0)+1,z:target.z||0},color,life:.07,size:.045,additive:true});
    this.muzzleLights?.flash(color,from,.06,3.2);
    return 1;
   }
   if(type==='deployable-expire'||type==='deployable-destroyed'){
    const model=this.deployableModels?.get(e.sentry)?.position,pos=model?{x:model.x,y:model.y,z:model.z}:(sentry?{x:Number(sentry.x)||0,y:Number(sentry.y)||0,z:Number(sentry.z)||0}:null);
    if(!pos)return 0;
    this.effectPool??=new EffectPool(this.scene);
    const count=type==='deployable-destroyed'?4:2;
    for(let i=0;i<count;i++)this.effectPool.add({pos:V((pos.x||0)+(Math.random()-.5)*.5,(pos.y||0)+.45+Math.random()*.4,(pos.z||0)+(Math.random()-.5)*.5),color:'#33302c',endColor:'#12100e',fade:'exp',damping:.9,size:.14,life:.75,expand:.4,velocity:V((Math.random()-.5)*.5,.7+Math.random()*.5,(Math.random()-.5)*.5)});
    return count;
   }
   return 0;
  }
  // Damage readability for actor models, called from the `damage` event branch.
  // A non-breaking shield hit pulses the existing per-model shield mesh through
  // the timestamp consumed by `_pulseShield` (scale/opacity only; the material
  // colour is owned by the actor pass). A low-health actor emits a throttled
  // pooled smoke wisp and an occasional spark, mirroring the damaged-vehicle
  // code. WebGL-only and suppressed under reduced motion; each emission is
  // bounded per actor by its own timestamp.
  _damageReadability(e,reduced){
   if(!e||reduced||this.renderer?.isSoftware===true)return 0;
   const model=this.actorModels?.get?.(e.actor);if(!model)return 0;
   const now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now(),shield=model.userData?.shield;
   if(shield&&!e.shieldBreak&&Number(e.shield)>0)model.userData.shieldPulseUntil=now+260;
   const victim=this._matchRef?.actors?.find?.(actor=>actor?.id===e.actor),maxHealth=Number(victim?.maxHealth)||0,health=Number(victim?.health)||0;
   if(!victim||!(maxHealth>0)||!(health>0)||health/maxHealth>.35)return 0;
   const p=model.position||{},particleScale=this._particleScale();let spawned=0;
   if(now-(model.userData.lowHealthSmokeAt??-Infinity)>=320){
    model.userData.lowHealthSmokeAt=now;this.effectPool??=new EffectPool(this.scene);
    this.effectPool.add({pos:V(p.x||0,(p.y||0)+1.05,p.z||0),color:'#3d3a36',endColor:'#141210',fade:'exp',damping:.9,size:.16*particleScale,life:.85,expand:.45,velocity:V((Math.random()-.5)*.4,.8+Math.random()*.6,(Math.random()-.5)*.4)});
    spawned++;
   }
   if(now-(model.userData.lowHealthSparkAt??-Infinity)>=700){
    model.userData.lowHealthSparkAt=now;this.effectPool??=new EffectPool(this.scene);
    this.effectPool.add({pos:V((p.x||0)+(Math.random()-.5)*.6,(p.y||0)+.9,(p.z||0)+(Math.random()-.5)*.6),color:'#ffcf7a',endColor:'#7a2200',fade:'exp',damping:1.6,gravity:8,size:.05*particleScale,life:.4,additive:true,velocity:V((Math.random()-.5)*3,Math.random()*2+.5,(Math.random()-.5)*3)});
    spawned++;
   }
   return spawned;
  }
  // Consume the shield-pulse timestamp set by `_damageReadability`. Scale and
  // opacity only: the colour assignment stays in the actor pass and the exact
  // hex assertions keep passing. Always restores the authored .7/1/.7 shell.
  _pulseShield(m,hasEnergyShield,now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now()){
   const shield=m?.userData?.shield;if(!shield?.scale)return 0;
   const until=Number(m.userData.shieldPulseUntil)||0,pulse=until>now?Math.max(0,Math.min(1,(until-now)/260)):0,scale=.7*(1+.22*pulse);
   shield.scale.set(scale,1+.22*pulse,scale);
   if(shield.material)shield.material.opacity=(hasEnergyShield?.24:.13)+.34*pulse;
   return pulse;
  }
  // WebGL contact shadows under living actors and vehicles. WebGL-only and
  // reduced-motion suppressed (the CPU renderer keeps its per-model blob
  // shadows); the pool follows presentation transforms after interpolation so
  // the shadow never lags the model it grounds. Bounded, cleared per match and
  // disposed with the view.
  _syncContactShadows(match,reduced){
   if(this.renderer?.isSoftware===true||reduced){this.contactShadows?.clear();return 0;}
   const sample=this._groundSample(match);
   let placed=0;
   const pool=this.contactShadows??=new ContactShadowPool(this.scene,16);
   for(const actor of match?.actors??[]){
    const model=this.actorModels?.get(actor.id);
    if(!model?.visible||actor.health<=0||actor.vehicleId!=null)continue;
    const x=model.position.x,z=model.position.z,ground=sample(x,z,model.position.y);
    if(!Number.isFinite(ground))continue;
    const height=Math.max(0,model.position.y-ground);if(height>6)continue;
    const fade=Math.max(.15,1-height/6);
    if(pool.place(`a:${actor.id}`,x,ground+.035,z,{radius:.66*fade,opacity:.4*fade}))placed++;
   }
   for(const vehicle of match?.vehicles??[]){
    const model=this.vehicleModels?.get(vehicle.id);
    if(!model?.visible)continue;
    const x=model.position.x,z=model.position.z,ground=sample(x,z,model.position.y);
    if(!Number.isFinite(ground))continue;
    const radius=vehicle.kind==='hornet'?1.6:1.25;
    if(pool.place(`v:${vehicle.id}`,x,ground+.04,z,{radius,opacity:.34}))placed++;
   }
   for(const sentry of (match?.deployables||[]).slice(0,4)){
    const model=this.deployableModels?.get(sentry?.id);
    if(!model?.visible)continue;
    const x=model.position.x,z=model.position.z,ground=sample(x,z,model.position.y);
    if(!Number.isFinite(ground))continue;
    if(pool.place(`d:${sentry.id}`,x,ground+.035,z,{radius:.5,opacity:.32}))placed++;
   }
   pool.end();
   return placed;
  }
  poseCorpse(m,a,match,{reduced=null,ragdoll=null}={}){
   const lifecycle=this.characterLifecycle??=new CharacterLifecycle({maxCorpses:24,maxLifetime:4});
   const ctx=this.deathContext?.get(a.id);
   const plan=ctx?.plan??deathPlan({seed:(a.id*7+(a.deaths??0)*13)>>>0});
   const motion=reduced===null?this.reduced():reduced===true;
   const arena=match?.arena??MAPS.find(map=>map.id===match?.mapId)??MAPS[0];
   lifecycle.update(m,a,{time:match?.time??0,plan,reduced:motion,hidden:a.id===this.playerId,direction:ctx?.direction??null,authoritative:ctx!==undefined,
    // Presentation-only ragdoll: the CPU renderer, reduced motion and hidden
    // bodies keep the authored fallback and the hard gate lives in the lifecycle.
    software:this.renderer?.isSoftware===true,ragdoll,arena,blocks:arena?.blocks??null,
    // Override with the shared spatial support selector for stacked platforms.
    // A callback returning null is void and MUST NOT fall back to an invented floor.
    sampleGround:(x,z,referenceY)=>typeof this.characterGroundAt==='function'
      ?this.characterGroundAt(x,z,referenceY,match)
      :presentationSupportAt(x,z,arena,referenceY)});
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
   setAudio(audio){this.viewAudio=audio||null;if(audio&&this._modeTheme)audio.setModeTheme?.(this._modeTheme);audio?.setSpace?.(mothSpaceFor(this.mapId));audio?.setEchoMap?.(mothEchoFor(this.mapId));const arena=this.showcaseState?.arena??(typeof this.mapId==='string'?MAPS.find(map=>map.id===this.mapId):null);applyArenaBiomePalette(audio,arena??this.mapId??null);const kind=this._weatherState().kind;audio?.setWeather?.(kind);this._audioWeatherKind=kind;return this.viewAudio;}
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
   updateSky(){if(this.sky)this.sky.position.copy(this.camera.position);if(this.mountains)this.mountains.position.copy(this.camera.position);for(const mesh of this.backdrop??[])mesh.position.copy(this.camera.position);}
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
   // Interior ambience: while the presented camera sits inside an authored
   // building/cavern/tunnel volume the fog thickens and the key light dampens,
   // and both ease back to the stored arena base as the camera leaves. Runs
   // after the weather pass as its own step so `_applyArenaLook` and
   // `_updateWeather` keep their exact density contract; WebGL only, because
   // the CPU renderer ignores scene.fog and shades from its own tables.
   _updateInteriorAmbience(delta,reduced=this.reduced?.()===true){
    const fog=this.scene?.fog;
    if(this.renderer?.isSoftware===true||!fog||!(Number(fog.density)>=0))return 0;
    const point=this.camera?.position,inside=point&&this.interiors?.length&&interiorAt(this.interiors,point)?1:0;
    const blend=this._interiorBlend??0,dt=Math.max(0,Math.min(Number(delta)||0,.25));
    const next=reduced?inside:blend+(inside-blend)*(1-Math.exp(-1.1*dt));
    this._interiorBlend=Math.abs(next-inside)<.001?inside:next;
    const state=this._weatherState(),look=this._arenaLook;
    if(look)fog.density=(Number(look.fogDensity)||0)*(Number(state?.preset?.density)||1)*(1+.55*this._interiorBlend);
    const lights=this._arenaLight;
    if(lights){
     const material=state?.preset?.material||{},dark=Math.max(0,Math.min(1,Number(material.dark)||0)),flash=Math.max(0,Number(this._flash)||0),damp=this._interiorBlend;
     for(const light of this.scene.children||[]){
      if(light.isHemisphereLight)light.intensity=(Number(lights.hemi)||light.intensity)*(1-dark*.22)*(1+flash*.5)*(1-.18*damp);
      else if(light.isDirectionalLight&&!light.userData?.rimLight)light.intensity=(Number(lights.sun)||light.intensity)*(1-dark*.5)*(1+flash*.8)*(1-.22*damp);
     }
    }
    return this._interiorBlend;
   }
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
    // Precipitation identity: the view owns the resolved kind, so it is the host
    // that forwards it (ash/snow need the explicit kind; rain is inferred by the
    // bed mood too, but this keeps the two in sync).
    if(this.viewAudio?.setWeather&&this._audioWeatherKind!==state.kind){this.viewAudio.setWeather(state.kind);this._audioWeatherKind=state.kind;}
    const wind=Number.isFinite(state.preset?.wind)?state.preset.wind:null;if(this.viewAudio?.setWind&&this._audioWind!==wind){this.viewAudio.setWind(wind);this._audioWind=wind;}
    return state;
   }
   // Weather adds route through a view-owned wrapper: rain/storm drops render as
   // velocity-aligned streaks and schedule pooled ground splashes, while snow/ash
   // keep the shared ambient pool path. feedback.mjs's WeatherFX is untouched:
   // the wrapper only reshapes the descriptors the view owns.
   _weatherAdd(desc){
    const pool=this.weatherPool;if(!pool||!desc)return null;
    if(!(Number(desc.streak)>1))return pool.add(desc);
    const p=desc.pos||{},v=desc.velocity||{x:0,y:-1,z:0};
    const vx=Number(v.x)||0,vy=Number(v.y)||0,vz=Number(v.z)||0,speed=Math.hypot(vx,vy,vz)||1;
    const length=Math.max(.18,Math.min(1.2,speed*.06));
    this._scheduleWeatherSplash(desc);
    return pool.add({from:{x:p.x||0,y:p.y||0,z:p.z||0},to:{x:(p.x||0)+vx/speed*length,y:(p.y||0)+vy/speed*length,z:(p.z||0)+vz/speed*length},color:desc.color,life:desc.life,size:Math.max(.012,(Number(desc.size)||.03)*.85),startOpacity:.55,additive:false,gravity:0,velocity:{x:vx,y:vy,z:vz}});
   }
   // Ground sample for weather splashes/scorches. Uses the host hook when present
   // and the pure spatial selector otherwise, mirroring the actor alignment path.
   _sampleWeatherGround(x,z,referenceY){
    if(typeof this.characterGroundAt==='function')return this.characterGroundAt(x,z,referenceY,this._matchRef);
    return presentationSupportAt(x,z,this._weatherArena??MAPS[0],referenceY);
   }
   // Schedule a splash when a drop's deterministic trajectory reaches the
   // supported ground inside its lifetime. One in five drops qualifies and at
   // most three land per frame, so the ripple pool stays bounded and the splash
   // cadence is deterministic for a replay.
   _scheduleWeatherSplash(desc){
    const serial=this._weatherSplashSerial=(this._weatherSplashSerial+1)>>>0;
    if(serial%5!==0||(this._weatherSplashUsed??0)>=3)return false;
    const p=desc?.pos,v=desc?.velocity,vy=Number(v?.y);if(!(vy<0))return false;
    const x=Number(p?.x)||0,y=Number(p?.y)||0,z=Number(p?.z)||0;
    const ground=this._sampleWeatherGround(x,z,y);
    if(!Number.isFinite(ground))return false;
    const drop=y-ground;if(!(drop>.05)||drop>26)return false;
    const delay=Math.max(0,Math.min(.9,drop/-vy)),vx=Number(v?.x)||0,vz=Number(v?.z)||0;
    const landing=this._sampleWeatherGround(x+vx*delay,z+vz*delay,y);
    const pool=this.ripplePool??=new RipplePool(this.scene,18);
    this._weatherSplashUsed=(this._weatherSplashUsed??0)+1;
    return Boolean(pool.spawn({x:x+vx*delay,y:(Number.isFinite(landing)?landing:ground)+.02,z:z+vz*delay},{color:desc.color||'#cfe0ef',delay,life:.5,size:.3,seed:serial,reduced:false}));
   }
   _updateWeatherFx(delta,reduced,quality,arena){
    if(this.renderer?.isSoftware===true||reduced){this.ripplePool?.clear();return 0;}
    const state=this._weatherState();
    if(!(state.preset?.particles>0)){this.ripplePool?.clear();return 0;}
    const origin=this.camera?.position;if(!origin)return 0;
    this.weatherPool??=new EffectPool(this.scene,48);
    // WeatherFX stores the pool object and calls `pool.add`, so the wrapper is a
    // tiny pool-shaped object rather than a bare function.
    this.weatherAdd??={add:(desc)=>this._weatherAdd(desc)};
    this.weatherArena=arena??this._matchRef?.arena??MAPS.find(map=>map.id===this.mapId)??MAPS[0];
    const effectsScale=Number.isFinite(this._effectsScale)?this._effectsScale:1;
    if(!this.weatherFx)this.weatherFx=new WeatherFX(this.weatherAdd,{seed:this._weatherSeed??1,cap:weatherParticleCap(state.preset,quality,effectsScale,44)});
    this.weatherFx.cap=weatherParticleCap(state.preset,quality,effectsScale,44);
    this.weatherFx.setPreset(state.preset);
    this._weatherSplashUsed=0;
    const active=this.weatherFx.update(delta,origin,{radius:10,quality:(quality?.particles??1)*effectsScale,software:false,reduced:false});
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
    if(this._lightningPreset!==preset){this._lightningPreset=preset;this._lightningWindow=90;this._lightningScheduleSeed=this._weatherSeed??1;this._lightning=lightningSchedule(preset,{seed:this._lightningScheduleSeed,window:this._lightningWindow,count:8});this._lightningAt=0;this._lightningFired=new Set();}
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
    if(this._lightningAt>(this._lightningWindow??90)){this._lightningAt=0;this._lightningFired=new Set();this._lightningScheduleSeed=(this._weatherSeed??1)+((this._lightningCycle=(this._lightningCycle??0)+1)>>>0);this._lightning=lightningSchedule(preset,{seed:this._lightningScheduleSeed,window:this._lightningWindow,count:8});}
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
    if(this.viewAudio?.thunder)this.viewAudio.thunder({distance:strike.distance,pan:strike.pan,intensity:strike.intensity*(strike.thunderGain??1),seed:this._lightningScheduleSeed??this._weatherSeed??1});
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
    const origin=this._audioFocusPosition();
    if(origin&&pos&&Math.hypot((pos.x||0)-origin.x,(pos.z||0)-origin.z)>34)return false;
    this._nearActionAt=time;
    this._nearAction=event.type==='explosion'||event.type==='death'?1:Math.max(this._nearAction||0,.72);
    return true;
   }
   // Proximity origin for the dynamic music/bed layer. Spectating or following a
   // manual subject moves the camera off the local player, so intensity is
   // measured from the actor the view is actually presenting; a missing model
   // falls back to the live camera.
   _audioFocusPosition(){
    const focusId=Number.isInteger(this._audioFocusId)?this._audioFocusId:this.playerId;
    return this.actorModels?.get(focusId)?.position||null;
   }
   _nearbyAction(match,time){
    const origin=this._audioFocusPosition()||this.camera?.position;let proximity=0;
    if(origin)for(const rocket of (match?.rockets||[])){const position=rocket?.pos;if(position&&Math.hypot((position.x||0)-origin.x,(position.z||0)-origin.z)<18)proximity=Math.max(proximity,.85);}
    return Math.max(this.audioIntensity(time),proximity);
   }
   _updateAudio(match,time){const audio=this.viewAudio;if(!audio?.setIntensity)return 0;const value=this._nearbyAction(match,time);if(Math.abs((audio.intensity||0)-value)>.02)audio.setIntensity(value);return audio.intensity||0;}
   setKillcam(on){this.killcamEnabled=on!==false;if(!this.killcamEnabled)this._killcam=null;}
   get killcam(){return this._killcam;}
   killcamActive(){return this._killcam!==null;}
   // Pure presentation query: which actor id the camera is following right now.
   // Manual follow wins, then an explicit spectator target while spectating,
   // then the local spectate/demo director's current subject while the cinema
   // owns the camera.
   followTargetId(){
    if(Number.isInteger(this.manualFollowId))return this.manualFollowId;
    if(this.spectator===true&&Number.isInteger(this.spectatorTarget))return this.spectatorTarget;
    const target=this.director?.targetId;
    if((this.cinema===true||this.spectator===true)&&Number.isInteger(target))return target;
    return null;
   }
   // Spectator/kill-cam readability pass. A pooled ring+chevron marker tracks the
   // followed actor and a killer bracket tracks `_killcam.killerId` while a
   // kill-cam is active; with neither there is nothing on screen and no pool is
   // allocated. Geometry-only (so the CPU renderer keeps a usable marker) and
   // static under reduced motion.
   _updateFollowMarkers(match,reduced=this.reduced()){
    const followId=this.followTargetId(),killerId=Number.isInteger(this._killcam?.killerId)?this._killcam.killerId:null;
    if(followId==null&&killerId==null){this.followMarkers?.clear();return 0;}
    if(!this.scene)return 0;
    const pool=this.followMarkers??=new FollowMarkerPool(this.scene,2),software=this.renderer?.isSoftware===true,time=Number(match?.time)||0;
    const positionOf=id=>{
     const model=this.actorModels?.get?.(id);
     if(model&&model.visible!==false&&model.position)return model.position;
     const actor=(match?.actors||[]).find(entry=>entry?.id===id);
     return actor?{x:actor.x||0,y:actor.y||0,z:actor.z||0}:null;
    };
    let placed=0;
    const follow=followId==null?null:positionOf(followId);
    if(follow){pool.place('follow',follow.x,follow.y,follow.z,{color:FOLLOW_MARKER_COLOR,kind:'follow',time,pulse:!reduced&&!software});placed++;}
    const killer=killerId==null?null:positionOf(killerId);
    if(killer){pool.place('killer',killer.x,killer.y,killer.z,{color:KILLER_MARKER_COLOR,kind:'killer',time,pulse:!reduced&&!software});placed++;}
    pool.end();
    return placed;
   }
   render(mode,match,delta,time){
    // Display frame cap. The host keeps stepping the fixed-dt simulation; only
    // this presentation frame is skipped, and the skipped wall-clock time is
    // carried into the next drawn frame so pooled effects age correctly.
    const cap=Number(this.display?.fpsCap)||0,nowFn=(typeof performance!=='undefined'&&performance.now)?performance.now.bind(performance):Date.now,now=nowFn();
    if(cap>0&&!frameDue(now,this._renderAt,cap)){
     this._renderCarry=Math.max(0,Math.min(1,(this._renderCarry||0)+Math.max(0,Math.min(Number(delta)||0,.25))));
     return false;
    }
    this._renderAt=cap>0?now:undefined;
    // Adaptive lab budget runs before the frame is described, so a level change
    // rebuilds the composer/targets before this frame's passes are chosen.
     const frameDelta=(Number(delta)||0)+(this._renderCarry||0);this._renderCarry=0;
     // Menus may draw only a preview, so their cheap frames cannot establish
     // that the full match look is affordable. Include cap-skipped time when
     // measuring drawn match frames, just as the quality governor does.
     if(this._labDrawnLast===true)this._sampleLabBudget(frameDelta);
     this._labDrawnLast=false;
    // Reset the (auto-reset-disabled) counters once per presented frame, then
    // account for every pass — world, post and the first-person weapon pass.
    // Optional-chained so a renderer that exposes no reset (or no info at all)
    // degrades to untracked counters instead of throwing every frame.
    this.renderer?.info?.reset?.();
    if(this.perf){this.perf.submitMs=0;this.perf.weaponSubmitMs=0;}
    const perfStart=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    try{return this._renderFrame(mode,match,frameDelta,time);}finally{this._capturePerf(perfStart);}
   }
   _renderFrame(mode,match,delta,time){this.motionQuery??=window.matchMedia?.('(prefers-reduced-motion: reduce)');this.resize();this._sampleQuality(delta);const reduced=this.reduced();this._fovPulse=Math.max(0,(this._fovPulse||0)-Math.max(0,Number(delta)||0)*2);
    // Advance the shared Moth iridescence phase from the view clock. Pure in
    // `time` (the module is a deterministic function of its argument) and pinned
    // so reduced motion holds a still phase; the Moth rift material reads it.
    this._mothPhase=updateMoth(reduced?0:(Number.isFinite(time)?time:0));if(mode!==this._lastMode){this._lastMode=mode;this.clearFreeMotion();}if((mode==='selection'||mode==='progression')&&!this.showcaseState){if(this.showcaseExpected){this.renderer.render(this.scene,this.camera);return;}const m=this.menu.model;m.rotation.y=Math.PI+.25+(reduced?0:Math.sin(time*.25)*.2);m.position.y=.17+(reduced?0:Math.sin(time)*.025);m.userData.rig?.update({dt:Math.max(0,Math.min(.1,delta||0)),time,reduced,speed:0,maxSpeed:8,grounded:true});
     // The no-showcase path still owns a real sidebar preview. Keep the backdrop
     // free of a second full-screen operator and use the same measured viewport.
     if(this.previewRect&&this.renderer instanceof T.WebGLRenderer){const visible=m.visible;m.visible=false;try{this.renderer.render(this.menu.scene,this.menu.camera);}finally{m.visible=visible;}this._renderPreview(time,reduced);}
     else this.renderer.render(this.menu.scene,this.menu.camera);
     return;}if((mode==='selection'||mode==='theater'||mode==='progression'||mode==='changelog'||mode==='browse'||mode==='lobby')&&!match)match=this.showcaseState;
      if(!match)return;this._matchRef=match;const owner=this.cameraOwner,actors=match.actors||[],follow=owner==='manual'&&this.manualFollowId!=null?this.manualFollowId:null,freeCam=owner==='free'&&this._freeCam===true,cinematic=this.cinema===true&&!!this.director&&!freeCam,raceActive=cameraOwnerAllowsRace(owner)&&!this.directorLock&&!!match.race;let player=cinematic?actors[0]:(actors.find(a=>a.id===this.playerId)||actors[0]);if(follow!=null)player=actors.find(a=>a.id===follow)||player;if(!cinematic&&(this.spectator||follow!=null))player=spectateActor(actors,follow??this.spectatorTarget)||player;if(!player)return;this._audioFocusId=Number.isInteger(player.id)?player.id:this.playerId;const arena=match.arena||MAPS.find(a=>a.id===match.mapId)||MAPS[0];const savedPlayerId=this.playerId;this.updateFlags(match,arena);this.updateObjectives(match,arena);this.updateSpots(match);this.updateWaypoint(match,arena);this.updatePayloadModel(match,arena,time);this.updateDeployables(match,reduced);this.updateMothRift(time,reduced);if(!reduced)this._mothRift?.material?.userData?.setMothPhase?.(this._mothPhase??0);this.updateZipRides(match,Math.max(0,delta),reduced);if(cinematic)this.playerId=-1;const cinemaPose=cinematic?this.director.update(match,Math.max(0,delta),match.events||[]):null;if(freeCam){this.camera.position.set(this.freePose.x,this.freePose.y,this.freePose.z);this.camera.rotation.set(this.freePose.pitch,this.freePose.yaw,0,'YXZ');}else if(cinemaPose&&!raceActive){this.camera.position.set(cinemaPose.x,cinemaPose.y,cinemaPose.z);this.camera.rotation.set(cinemaPose.pitch,cinemaPose.yaw,cinemaPose.roll||0,'YXZ');this._clearCamera(player,delta,cinemaPose.cut);this._applyFreeExitBlend(delta,reduced);}else{const pres=this._interpEnabled?this._presentActor(player.id):null,px=pres&&!pres.snapped?pres.x:(player.x||0),py=pres&&!pres.snapped?pres.y:(player.y||0),pz=pres&&!pres.snapped?pres.z:(player.z||0);const eyeY=py+(player.health>0?(player.eyeHeight??1.45):.65),yaw=(player.yaw||0)+(player.punchYaw||0),pitch=(player.pitch||0)+(player.punchPitch||0);if(this.spectator&&this.spectatorThird===true){const dist=4.6,cos=Math.cos(pitch);this.camera.position.set(px+Math.sin(yaw)*dist*cos,eyeY+1.1-Math.sin(pitch)*dist,pz+Math.cos(yaw)*dist*cos);}else this.camera.position.set(px,eyeY,pz);this.camera.rotation.set(pitch,yaw,0,'YXZ');this._applyFreeExitBlend(delta,reduced);}this.cameraShake??=new CameraShake();const aiming=this.aim===true||player.ads===true,baseFov=this.display?.fov??82;
const activeSight=this._activeSight=resolveActiveSight({weapon:player.weapon,optic:player.attachments?.visual?.optic,aiming});
// Player FOV is updated with the weapon pose below; director/free camera keep ownership here.
if(cinemaPose)this.camera.fov=Math.max(50,Math.min(100,cinemaPose.fov||this.camera.fov));if(freeCam)this.camera.fov=Math.max(50,Math.min(100,this.display?.fov??82));this.camera.updateProjectionMatrix();
if(this._killcam&&!freeCam&&!cinematic&&cameraOwnerAllowsRace(owner)){const elapsed=(Number.isFinite(time)?time:0)-this._killcam.start,kc=killcamPose({elapsed,duration:this._killcam.duration,focus:this._killcam.focus,killer:this._killcam.killer,seed:this._killcam.seed,reduced});if(kc.phase>=1){this._killcam=null;}else{this.camera.position.set(kc.x,kc.y,kc.z);this.camera.lookAt(kc.lookX,kc.lookY,kc.lookZ);this.camera.fov=Math.max(50,Math.min(100,kc.fov));this.camera.updateProjectionMatrix();}}
if(freeCam){this.lowHealthOverlay?.update(false,time,delta,reduced,this.camera);}else if(!cinematic&&cameraOwnerAllowsRace(owner)){this.cameraShake.apply(this.camera,time,reduced,this.display?.cameraShake??1);this.cameraShake.update(Math.max(0,delta));this.lowHealth=player.health>0&&player.health<=(player.maxHealth??100)*.35;this.lowHealthOverlay?.update(this.lowHealth,time,delta,reduced,this.camera);}else this.lowHealthOverlay?.update(false,time,delta,reduced,this.camera);
      actors.forEach((a,i)=>{const m=this.actorModels.get(a.id);if(!m)return;const mounted=a.vehicleId!=null;if(a.health<=0){this.poseCorpse(m,a,match);return;}this.deathContext?.delete(a.id);this.reviveCorpse(m,a,match);m.visible=a.id!==this.playerId;m.position.set(a.x||0,a.y||0,a.z||0);if(mounted){const rider=match.vehicles?.find(v=>v.id===a.vehicleId),chassis=Number.isFinite(rider?.yaw)?rider.yaw:Number.isFinite(rider?.heading)?rider.heading:a.yaw;m.rotation.y=(Number.isFinite(chassis)?chassis:0)-Math.PI;}else m.rotation.y=Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0);const bodyYaw=Number.isFinite(a.bodyYaw)?a.bodyYaw:(a.yaw||0),speed=Math.hypot(a.vx||0,a.vz||0),localX=(a.vx||0)*Math.cos(bodyYaw)-(a.vz||0)*Math.sin(bodyYaw),localZ=-((a.vx||0)*Math.sin(bodyYaw)+(a.vz||0)*Math.cos(bodyYaw));m.userData.rig?.update({dt:Math.max(0,Math.min(.1,delta||0)),time,reduced,speed:mounted?0:speed,maxSpeed:a.moveSpeed||8,grounded:mounted?true:a.grounded!==false,crouch:!mounted&&a.crouching===true,ads:!mounted&&a.ads===true,reload:!mounted&&a.reloading?1:0,strafe:mounted?0:Math.max(-1,Math.min(1,localX/3)),forward:mounted?0:Math.max(-1,Math.min(1,localZ/3)),focusYaw:Math.atan2(Math.sin((a.yaw||0)-bodyYaw),Math.cos((a.yaw||0)-bodyYaw)),focusPitch:-(a.pitch||0),bank:reduced?0:Math.max(-1,Math.min(1,((a.yaw||0)-bodyYaw)*1.1)),hit:(!reduced&&(m.userData.hitUntil??0)>performance.now())?(m.userData.hitStrength??1):0});if(m.userData.gunAnchor){const aimYaw=Math.atan2(Math.sin((a.yaw||0)-bodyYaw),Math.cos((a.yaw||0)-bodyYaw));m.userData.gunAnchor.rotation.x=reduced?0:Math.max(-.7,Math.min(.7,a.pitch||0));m.userData.gunAnchor.rotation.y=reduced?0:Math.max(-.9,Math.min(.9,aimYaw));}if(!reduced&&a.health>0&&a.active>0&&a.harness==='hermes'&&(match.time||0)-(m.userData.trailAt||0)>.1){m.userData.trailAt=match.time;this.effectPool??=new EffectPool(this.scene);this.effectPool.add({pos:V(a.x,a.y+.4,a.z),color:m.userData.color,size:.11,life:.3});}m.userData.torso.material.emissive.set(a.active>0&&['opencode','codex','cline','roo'].includes(a.harness)?m.userData.color:'#000000');m.userData.torso.material.emissiveIntensity=a.active>0?.7:0;const hasEnergyShield=(a.temporaryShield||0)>0||(a.juggernautShield||0)>0;m.userData.shield.material.color.set(a.slow>0?'#d89aff':(a.juggernautShield||0)>0?'#ffd166':hasEnergyShield?'#70ffe6':m.userData.color);this._pulseShield(m,hasEnergyShield);m.userData.shield.visible=a.slow>0||a.protection>0||(a.harness==='claudecode'&&a.active>0)||hasEnergyShield;if(m.userData.weapon.userData.type!==a.weapon){m.userData.gunAnchor.remove(m.userData.weapon);this.disposeObject(m.userData.weapon);m.userData.weapon=simpleWeaponModel(a.weapon,this.modelAssets,a.attachments?.visual,a.finish);this._trackAssets();m.userData.gunAnchor.add(m.userData.weapon);}m.userData.weapon.userData.flash.visible=!reduced&&(m.userData.flashUntil??0)>performance.now();});
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
   // Contact shadows follow the final presentation transforms (post-interp).
   this._syncContactShadows(match,reduced);
   this.updateRace(match,time);
   if(raceActive){if(cinematic)this._raceDemoCamera(match,arena,player,delta,time,reduced);else{const standingsCar=match.race.kind==='soccer'?match.race.standings?.find(r=>r.actorId===player.id)?.vehicleId:null;const car=match.vehicles?.find(v=>v.id===player.vehicleId)||(match.race.kind==='soccer'?(match.vehicles?.find(v=>v.id===standingsCar)||match.vehicles?.[0]):null);if(car){const centerline=arena?.race?.centerline||match.race?.centerline||match.arena?.race?.centerline||[],pose=raceDemoPose({mode:'chase',centerline,vehicle:car});this.camera.position.set(pose.x,pose.y,pose.z);this.camera.lookAt(pose.lookX,pose.lookY,pose.lookZ);}}}
   for(const actor of actors){const model=this.actorModels.get(actor.id);if(model)this.styleActor(model,actor,this.display?.teamPalette);}
   for(const zone of this.objectiveMarkZones(match)){const model=this.objectiveModels?.get(String(zone.id));if(!model)continue;const mark=model.userData.teamMark??=teamMark();if(!mark.parent){mark.position.y=1.45;mark.scale.setScalar(2);model.add(mark);mark.traverse(n=>{n.userData.objective=true;n.userData.noCameraOcclusion=true;});}this._styleZoneMark(mark,zone);}
       if((this.qualitySettings?.modelDetail??1)<1)this._applyModelDetail();
    (match.pickups||[]).forEach((p,i)=>{const m=this.pickupModels[i];if(!m)return;m.visible=(p.wait||0)<=0;m.rotation.y=reduced?0:time*.8;m.position.y=(p.y||0)+(reduced?0:Math.sin(time*2+i)*.07);});
   // Persistent projectile markers keep their identity frame to frame, and trail
   // puffs are emitted on a time accumulator (~30 Hz) instead of once per render,
   // so 60 and 144 fps produce roughly the same number of trail particles.
   this.projectilePool??=new EffectPool(this.scene,64);this.projectilePool.clear();
   const trailEm=trailEmissions(this._trailAt,Math.min(Number(delta)||0,.1));this._trailAt=trailEm.remainder;const emitTrail=trailEm.count>0;
   for(const [rocketIndex,r] of (match.rockets||[]).slice(0,64).entries())if(r.pos){const wp=r.weapon??0,pres=this._interpEnabled?this._presentRocket(rocketIndex):null,rp=pres&&!pres.snapped?pres:r.pos,altKind=altRocketKind(r);
    if(altKind){const altColor=altProjectileColor(altKind);this.projectilePool.add({pos:rp,color:altColor,size:.17,life:1});if(altKind==='mortar')this.projectilePool.add({pos:rp,color:'#dff6ff',size:.07,life:1});if(emitTrail&&!reduced&&this.effectPool&&this.renderer?.isSoftware!==true)this.effectPool.add({pos:V(rp.x,rp.y,rp.z),color:altColor,endColor:altKind==='mine'?'#002244':'#441100',fade:'smooth',damping:2,size:altKind==='mortar'?.05:.07,life:.24,expand:1.2,velocity:V((Math.random()-.5)*.6,(Math.random()-.5)*.6,(Math.random()-.5)*.6)});}
    else if(wp===4){this.projectilePool.add({pos:rp,color:'#72cfff',size:.2,life:1});this.projectilePool.add({pos:rp,color:'#dff6ff',size:.09,life:1});}else if(wp===5)this.projectilePool.add({pos:rp,color:'#ffb27a',size:.13,life:1});else this.projectilePool.add({pos:rp,color:'#ffad61',size:.15,life:1});if(!altKind&&emitTrail&&!reduced&&this.effectPool&&this.renderer?.isSoftware!==true&&(wp===1||wp===4||wp===5)){this.effectPool.add({pos:V(rp.x,rp.y,rp.z),color:wp===4?'#72cfff':wp===5?'#ffb27a':'#ffad61',endColor:wp===4?'#003366':wp===5?'#551100':'#441100',fade:'smooth',damping:2,size:wp===4?.06:.08,life:.22,expand:1.2,velocity:V((Math.random()-.5)*.6,(Math.random()-.5)*.6,(Math.random()-.5)*.6)});} }
   this._syncAltProjectiles(match.rockets,time,reduced);
  for(const e of (match.events||[]))if(e.id>this.lastEvent){this._noteCombatEvent(e,time);this.effect(e);this.abilityVfx?.handleEvent(e);this.lastEvent=e.id;}
   // Ability VFX advance once per frame from the same snapshot the view renders.
   // The update runs after the event loop so a rope placed this frame resolves
   // its origin from the placer's current position.
   this.abilityVfx?.update(Math.max(0,delta),match);
   this._updateMothSprites(Math.max(0,delta),this.camera);this.effectPool?.update(Math.max(0,delta));this.ripplePool?.update(Math.max(0,delta));this.altProjectiles?.update(Math.max(0,delta),{time,reduced});this.telegraphPool?.update(Math.max(0,delta));this.railPool?.update(Math.max(0,delta));this.deathPool?.update(Math.max(0,delta));this.decalPool?.update(Math.max(0,delta));
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
    this._applyMeleeSwing(delta,reduced);
    // Camera yaw/pitch above remain immediate; no extra camera recoil is added.
    if(!cinematic&&!freeCam&&!this._killcam&&follow==null){this.camera.fov=ads.fov+(reduced?0:(this._fovPulse||0)*6);this.camera.updateProjectionMatrix();}

    this._animateWeaponParts(this.firstPerson,player,reduced,delta);
    this._animateWeaponAlt(this.firstPerson,player,reduced,delta,time);
    this._updateWeaponHeat(this.firstPerson,reduced,delta);
    this.firstPerson.userData.flash.visible=!reduced&&this.hands.visible&&this.flashUntil>performance.now();this.muzzleLights?.update(Math.max(0,delta));if(this.sun?.castShadow!==false&&this.renderer.shadowMap?.autoUpdate===false){const hz=Number(this._quality().shadowHz)||30;if(shadowDue(time,this._shadowAt,hz)){this._shadowAt=time;const focus=this.camera?.position;this._fitShadowFrustum(focus?.x??0,focus?.z??0,SHADOW_FIT_EXTENT);this.renderer.shadowMap.needsUpdate=true;}}this.updateSky();this._updateWind(time,reduced);this._updateAmbient(match,delta,time,reduced);const spMode=match.config?.mode==='campaign'||match.config?.mode==='horde';if(spMode)this.setWeather(match.weather??null);else if(!cinematic&&this._weatherOverride!==null)this.setWeather(null);this._updateWeather(arena,delta,mode);this._updateWeatherFx(delta,reduced,this._quality(),arena);const software=this.renderer?.isSoftware===true;this._updateLightning(delta,reduced,software);this._updateInteriorAmbience(delta,reduced);this._applyWetSheen(this._weatherState());this.hitPool?.update(Math.max(0,delta));this.shellPool?.update(Math.max(0,delta));this._updateHitReactions();this._alignLivingCharacters(match);this._updateFollowMarkers(match,reduced);this._syncCarryBanners(match);this._updateDebris(delta);this._updateAudio(match,time);this._beginGpu();
    // Per-target stacks: when bots are styled, the world composer renders
    // through a camera that excludes the actor layer and the scene depth is
    // preserved (autoClear off + depth-writing passes disabled) so the bot
    // composite can reject pixels behind world geometry. Without a composer,
    // bots and weapons keep the direct path exactly as before.
     const labTargets=this.graphicsLab?.targets,botWanted=this._targetActive(labTargets?.bots,'bots')&&(this.actorModels?.size??0)>0,weaponWanted=this.hands.visible&&this._targetActive(labTargets?.weapon,'weapon');
     if(this.composer&&((botWanted&&!this._botTarget)||(weaponWanted&&!this._weaponTarget)))this._syncLabTargets();
     const weaponStyled=weaponWanted&&!!(this._weaponLab&&this._weaponTarget&&this._labDisplayTarget);
     this._renderWorldLayers(botWanted);
     this._labDrawnLast=this.graphicsLab?.enabled===true&&this.graphicsLab?.bypass!==true;
  // Isolated first-person pass: mirror the active camera onto a dedicated
  // weapon camera, clear the world depth, then draw the gun with normal depth
  // testing between its parts. The CPU fallback renders in the main camera.
  // A styled weapon target routes the same scene through its own offscreen
  // target and a transparent lab composite instead.
  if(this.weaponScene&&this.weaponCamera&&this.hands.visible){
   this._markWeaponSubmitStart();
   const wc=this.weaponCamera;wc.position.copy(this.camera.position);wc.quaternion.copy(this.camera.quaternion);wc.fov=this.weaponFov??this.camera.fov;wc.aspect=this.camera.aspect;wc.updateProjectionMatrix();wc.updateMatrixWorld(true);
   this.weaponRoot.position.copy(wc.position);this.weaponRoot.quaternion.copy(wc.quaternion);this.weaponRoot.updateMatrixWorld(true);
   if(!weaponStyled||!this._renderWeaponLayer(wc)){const prevAuto=this.renderer.autoClear;this.renderer.autoClear=false;this.renderer.clearDepth?.();this.renderer.render(this.weaponScene,wc);this.renderer.autoClear=prevAuto;}
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
       // A cached viewmodel returns to its rest pose before reuse so an alt
       // morph left over from its last owner cannot leak into the next swap.
       if(cached&&!cached.parent){cached.userData.altAmount=0;const spec=altSpecFor(cached.userData.type);applyAltMorph(cached,cached.userData.type,0,{reduced:true});if(spec)this._applyAltFlashColor(cached,spec,0);return cached;}
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
         return {...this.perf,labLevel:this._labLevel,labRetrySeconds:this._labBudget?.retry??0,adaptiveLab:this.adaptiveLab!==false,renderer:this.rendererInfo(),viewport:{...this.perf.viewport},calls:info?.render?.calls??this.perf.calls,triangles:info?.render?.triangles??this.perf.triangles,geometries:memory?.geometries??this.perf.geometries,textures:memory?.textures??this.perf.textures,programs:info?.programs?.length??this.perf.programs};
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
      // ---- Sustained-fire barrel heat --------------------------------------
      // Per-weapon shot counter feeding the `heat-glow` sleeve assembled on
      // every detailed model. Heat rises per shot and decays exponentially in
      // the per-frame viewmodel update; reduced motion and the low tier never
      // show the mesh, so this stays presentation-only.
      _heatShot(e,actorModel=null){
       const local=e?.actor===this.playerId,model=local?this.firstPerson:actorModel?.userData?.weapon;
       if(!model?.userData?.heatGlow)return 0;
       model.userData.heatShots=(model.userData.heatShots||0)+1;
       model.userData.heat=Math.min(1,(model.userData.heat||0)+.17);
       return model.userData.heat;
      }
      _updateWeaponHeat(weapon,reduced,delta){
       const data=weapon?.userData,glow=data?.heatGlow;
       if(!glow)return 0;
       const step=Math.max(0,Math.min(.25,Number(delta)||0)),tier=this._quality?.().tier??0;
       data.heat=(data.heat||0)*Math.exp(-step/.55);
       if(data.heat<.004)data.heat=0;
       const level=data.heat,on=reduced!==true&&tier>=1&&level>0;
       glow.visible=on;
       if(glow.material)glow.material.opacity=on?Math.min(.85,level*.85):0;
       return level;
      }
      _animateWeaponParts(weapon,player,reduced,delta){
       if(!weapon)return;
       const parts=weapon.userData.parts||{},anchors=weapon.userData.anchors||{};
       const base=node=>{if(node&&node.userData.baseZ===undefined){node.userData.baseX=node.position.x;node.userData.baseY=node.position.y;node.userData.baseZ=node.position.z;node.userData.baseRX=node.rotation.x;node.userData.baseRY=node.rotation.y;node.userData.baseRZ=node.rotation.z;}return node;};
       const mag=base(parts.magazine||anchors.magazine),bolt=base(parts.bolt||anchors.bolt),cell=base(parts.cell||anchors.cell),barrel=base(parts.barrel||anchors.barrel),support=base(weapon.userData.supportHand);
       const type=Number.isInteger(player.weapon)?player.weapon:(Number.isInteger(weapon.userData.type)?weapon.userData.type:0);
       if(reduced){
        if(mag)mag.position.set(mag.userData.baseX,mag.userData.baseY,mag.userData.baseZ);
        if(barrel){barrel.position.set(barrel.userData.baseX,barrel.userData.baseY,barrel.userData.baseZ);barrel.rotation.x=barrel.userData.baseRX;}
        if(cell)cell.rotation.z=cell.userData.baseRZ;
        if(bolt)bolt.position.set(bolt.userData.baseX,bolt.userData.baseY,bolt.userData.baseZ);
        if(support){support.visible=false;support.position.set(support.userData.baseX,support.userData.baseY,support.userData.baseZ);support.rotation.set(support.userData.baseRX,support.userData.baseRY,support.userData.baseRZ);}
        this._weaponInertia?.reset();
        return;
       }
       const timing=RELOAD_TIMING[type]||RELOAD_TIMING[0];
       const reloading=player.reloading===true,progress=reloading?Math.max(0,Math.min(1,1-(Number(player.reloadTimer)||0)/(Number(player.reloadDuration)||1))):0;
       // Per-weapon windows: the magazine/barrel/cell each travel over their own
       // slice of the reload instead of one shared sine, and the support hand
       // follows whichever part is moving before lifting into the inspection.
       const travel=reloading?reloadWindow(progress,timing.start,timing.end):0;
       const inspect=reloading?reloadWindow(progress,timing.inspect,Math.min(.99,timing.inspect+.24)):0;
       if(mag&&type!==0&&type!==3)mag.position.y=mag.userData.baseY-travel*timing.travel;
       if(barrel&&type===3){barrel.position.y=barrel.userData.baseY-travel*.1;barrel.rotation.x=barrel.userData.baseRX+travel*.45;}
       if(cell&&timing.cell)cell.rotation.z=cell.userData.baseRZ+progress*Math.PI*2*timing.cell;
       if(bolt){const kick=Math.max(0,Math.min(1,Number(this.feedback?.kick)||0));bolt.position.z=bolt.userData.baseZ+kick*.05+travel*timing.bolt;}
       if(support){
        const active=reloading&&(travel>0.001||inspect>0.001);
        support.visible=active;
        support.position.set(support.userData.baseX-travel*.02,support.userData.baseY-travel*(type===3?.04:.06),support.userData.baseZ+travel*(type===3?.05:.09));
        support.rotation.set(support.userData.baseRX+inspect*.32,support.userData.baseRY,support.userData.baseRZ-travel*.24);
       }
       // Weapon-inertia spring: yaw/pitch lag trails the look and composes on
       // top of the ADS/feedback pose. Channels are read only to phase-align the
       // punch; the lag itself is a small bounded rotation/offset.
       if(this.hands&&this.hands.visible!==false){
        const inertia=this._weaponInertia??(this._weaponInertia=new WeaponInertia());
        const frame=inertia.update({dt:delta??0,yaw:player.yaw,pitch:player.pitch,reduced:false,ads:this._adsTransition??0});
        const punch=Number(this.feedback?.channels?.punch?.pitch)||0;
        const gain=1+Math.max(-.4,Math.min(.4,punch*4));
        this.hands.rotateX(frame.pitch*gain);
        this.hands.rotateY(frame.yaw*gain);
        this.hands.position.x+=frame.offsetX*.6;
        this.hands.position.y+=frame.offsetY*.6;
        this.hands.position.z+=frame.offsetZ*.6;
       }else this._weaponInertia?.reset();
      }
      // ---- Alt-fire viewmodel morph (v8.6) ---------------------------------
      // Blends the hidden alt parts authored by weapon-models/alt-parts.mjs in
      // while the snapshot holds `player.alt`, and tints the muzzle flash to the
      // spec tracer colour. Reduced motion snaps both ways; otherwise the morph
      // takes ~0.16 s and stays frame-rate independent.
      _animateWeaponAlt(weapon,player,reduced,delta,time){
       if(!weapon)return 0;
       const type=Number.isInteger(player?.weapon)?player.weapon:(Number.isInteger(weapon.userData.type)?weapon.userData.type:0),spec=altSpecFor(type);
       if(!spec)return 0;
       const target=player?.alt===true?1:0,state=Number.isFinite(weapon.userData.altAmount)?weapon.userData.altAmount:0;
       let amount;
       if(reduced)amount=target;
       else{const step=Math.max(0,Math.min(.1,Number(delta)||0)),next=state+(target>state?step/.16:-step/.16);amount=target>state?Math.min(target,next):Math.max(target,next);}
       weapon.userData.altAmount=amount;
       applyAltMorph(weapon,type,amount,{reduced,time});
       this._applyAltFlashColor(weapon,spec,amount);
       return amount;
      }
      _applyAltFlashColor(weapon,spec,amount){
       const flash=weapon?.userData?.flash;if(!flash)return 0;
       const tint=this._altTint??=new T.Color();tint.set(spec.tracer);
       let tinted=0;
       flash.traverse(node=>{
        const material=node.material;if(!node.isMesh||!material?.color)return;
        material.userData.altBaseColor??=material.color.clone();
        material.color.copy(material.userData.altBaseColor).lerp(tint,amount);tinted++;
       });
       return tinted;
      }
      updateRace(match,time){syncRacePresentation(this,match,time);}
      _renderPreview(time,reduced){const rect=this.previewRect;if(!rect||rect.width<12||rect.height<12||!(this.renderer instanceof T.WebGLRenderer))return;const m=this.menu.model;m.rotation.y=Math.PI+.25+(reduced?0:Math.sin(time*.4)*.22);m.position.y=.17;const cam=this.menu.camera,aspect=Math.max(.2,rect.width/rect.height);if(cam.aspect!==aspect){cam.aspect=aspect;cam.updateProjectionMatrix();}this._renderSceneInto(this.renderer,rect,this.menu.scene,cam);}
          dispose(){this.characterLifecycle?.dispose?.();this.clearObjectiveMarkers();this.followMarkers?.dispose();this.followMarkers=null;this.effectPool?.dispose();this.telegraphPool?.dispose();this.projectilePool?.dispose();this.railPool?.dispose();this.deathPool?.dispose();this.decalPool?.dispose();this.ripplePool?.dispose();this.ripplePool=null;this.contactShadows?.dispose();this.contactShadows=null;this.debrisPool?.dispose();this.debrisPool=null;this.hitPool?.dispose();this.hitPool=null;this.abilityVfx?.dispose();this.abilityVfx=null;this.hitFlinch?.clear();this.shellPool?.dispose();this.shellPool=null;this.altProjectiles?.dispose();this.altProjectiles=null;this._clearDebugDeaths();this.ambientPool?.dispose();this.weatherPool?.dispose();this.ambientFx=null;this.weatherFx=null;this._killcam=null;this.preview?.dispose();this.preview=null;this.previewAssets?.dispose?.();this.previewAssets=null;disposeComposer(this.composer);this.composer=null;this._disposeLabTargets();this.muzzleLights?.dispose();this.lowHealthOverlay?.dispose();this._disposeMothSprites();this.zipCarriages?.clear();this.deployableModels?.clear();this.disposeObject(this.scene);if(this.weaponScene)this.disposeObject(this.weaponScene);this.disposeObject(this.menu.scene);this.environmentRT?.dispose?.();for(const resource of this.renderResources||[])resource.dispose();this.renderResources?.clear();for(const resource of this.sharedResources||[])resource.dispose();this.sharedResources?.clear();this.modelAssets?.materials.clear();this.modelAssets?.geometries.clear();this.modelAssets?.resources.clear();this.arenaAssets?.materials.clear();this.arenaAssets?.geometries.clear();this.arenaAssets?.resources.clear();clearSurfaceTextures();for(const model of this._weaponCache?.values?.()||[])this.disposeObject(model);this._weaponCache?.clear();this._freeCam=false;this._directorLock=false;this.manualFollowId=null;this._cameraOwner='auto';this._freeExit=null;this.clearFreeMotion();this.resetFreeCam();this.renderer.dispose();}
}
