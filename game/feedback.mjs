import * as T from 'three';
import {WEAPONS} from './data.mjs';
import {precipParticleAdds,biomeAmbience,weatherPreset} from './environment.mjs';
import {MusicEngine,HALO_THEME} from './music.mjs';
import {footstepProfile,impactProfile,reportStyle,reportVariation,eventSeed,mixUnit} from './sfx-design.mjs';
import {mothIr,mothEchoMap,mothMotif} from './moth-assets.mjs';
import {latticeSoundCue,createLatticeAudioState} from './lattice-feedback.mjs';
import {deathPlan} from './deaths.mjs';
import {createAnnouncerSelector} from './announcer-clips.mjs';

// Per-space reverb wetness for the baked convolution IRs. `cavern` keeps the
// historical .42; drier outdoor/tunnel responses sit lower, big interiors higher.
const SPACE_WET=Object.freeze({'open-air':.22,tunnel:.34,hall:.42,cathedral:.6,cavern:.42});

// Presentation only: these offsets must never be applied to the aiming camera.
const KICKS=WEAPONS.map(w=>w.feel?.kick||[.04,.04,16]);
// Shared zero channel set so a hidden/reduced weapon never allocates per frame.
const ZERO_CHANNEL=Object.freeze({pitch:0,roll:0});
export const EMPTY_CHANNELS=Object.freeze({recoil:ZERO_CHANNEL,punch:ZERO_CHANNEL,reload:ZERO_CHANNEL,swap:ZERO_CHANNEL,movement:ZERO_CHANNEL});
export class WeaponFeedback{
 constructor(){this.reset();}
 reset(){this.kick=0;this.landing=0;this.phase=0;this.bob=0;this.sway=0;this.grounded=undefined;this.vy=0;this.weapon=-1;this.lastShot=null;this.channels=EMPTY_CHANNELS;}
 shot(weapon,stamp){if(stamp!=null&&stamp===this.lastShot&&weapon===this.weapon)return;this.lastShot=stamp;this.weapon=weapon;this.kick=Math.min(1.4,this.kick+1);}
 update(player,dt,reduced=false,visible=true,bobScale=1){dt=Math.max(0,Math.min(dt||0,.1));const bobAmp=Math.max(0,Math.min(1.5,Number(bobScale)||0));const profile=KICKS[player.weapon]||KICKS[0];
  if(this.weapon!==player.weapon){this.kick=0;this.weapon=player.weapon;}
  if(this.grounded===false&&player.grounded)this.landing=Math.min(.035,Math.max(0,-this.vy)*.003);
  this.grounded=player.grounded;this.vy=player.vy||0;
  this.kick*=Math.exp(-profile[2]*dt);this.landing*=Math.exp(-14*dt);
  const speed=Math.min(1,Math.hypot(player.vx||0,player.vz||0)/7),blend=1-Math.exp(-12*dt);
  this.phase+=dt*10*speed;this.bob+=((player.grounded?speed:0)-this.bob)*blend;
  const lateral=(player.vx||0)*Math.cos(player.yaw||0)-(player.vz||0)*Math.sin(player.yaw||0);
  this.sway+=(Math.max(-.012,Math.min(.012,-lateral*.002))-this.sway)*blend;
  this.idleTime=(this.idleTime||0)+dt;
  const idle=(1-speed)*Math.sin(this.idleTime*1.8)*.0022;
  const idleY=(1-speed)*(Math.cos(this.idleTime*3.6)+Math.sin(this.idleTime*1.8)*.25)*.0016;
  const strafeRoll=Math.max(-.05,Math.min(.05,-lateral*.006));
  const lookSway=(player.punchYaw||0)*.02;
  if(reduced||!visible){this.kick=0;this.landing=0;this.bob=0;this.sway=0;this.channels=EMPTY_CHANNELS;return {x:0,y:0,z:0,pitch:0,roll:0};}
  const reloadT=player.reloading?Math.sin(Math.max(0,Math.min(1,1-(player.reloadTimer||0)/(player.reloadDuration||1)))*Math.PI):0;
  const reloadDipY=-0.045*reloadT,reloadPitch=-0.04*reloadT,reloadRoll=0.05*reloadT;
  const swapT=(player.weaponSwitch||0)>0?Math.sin(Math.min(1,Math.max(0,(player.weaponSwitch||0)/.45))*Math.PI):0;
  const swapDipY=-0.07*swapT,swapPitch=-0.04*swapT;
  // Named channels so the renderer can compose movement sway, recoil, reload and
  // weapon-switch transforms independently. `pitch`/`roll` stay the exact sums so
  // existing consumers keep their numbers.
  const recoilPitch=this.kick*profile[1],recoilRoll=this.kick*Number(profile[3]||0);
  const punchPitch=(player.punchPitch||0)*.015;
  const movementRoll=((this.sway+lookSway)*.7+strafeRoll)*bobAmp;
  this.channels={recoil:{pitch:recoilPitch,roll:recoilRoll},punch:{pitch:punchPitch,roll:0},reload:{pitch:reloadPitch,roll:reloadRoll},swap:{pitch:swapPitch,roll:0},movement:{pitch:0,roll:movementRoll}};
  return {x:(Math.sin(this.phase)*.007*this.bob+this.sway+idle+lookSway)*bobAmp,y:(Math.cos(this.phase*2)*.006*this.bob+idleY)*bobAmp-this.landing+reloadDipY+swapDipY,z:this.kick*profile[0],pitch:recoilPitch+punchPitch+reloadPitch+swapPitch,roll:movementRoll+reloadRoll};
 }
}

// Fixed-size reusable slots: bursts and pellets cannot grow GPU resources.
export class EffectPool{
  constructor(scene,limit=96){
    this.scene=scene;this.limit=limit;this.slots=[];this.serial=0;
    this.line=new T.CylinderGeometry(.5,.5,1,6).rotateX(Math.PI/2).translate(0,0,.5);
    this.sphere=new T.IcosahedronGeometry(1,0);
    this.axis=new T.Vector3(0,0,1);
    this.direction=new T.Vector3();
    this.scratchColor=new T.Color();
  }
  add({from,to,pos,color,life=.15,size=.08,expand=0,velocity=null,wireframe=false,additive=false,damping=0,gravity=null,spin=null,fade='linear',startOpacity=.8,endColor=null}){
   const line=!!from;let slot=this.slots.find(s=>!s.active&&s.line===line);
   if(!slot&&this.slots.length<this.limit){const mat=new T.MeshBasicMaterial({transparent:true,depthWrite:false});const obj=new T.Mesh(line?this.line:this.sphere,mat);slot={obj,line};this.slots.push(slot);this.scene.add(obj);}
   if(!slot){
     let oldest=null;
     for(let i=0;i<this.slots.length;i++){
       const s=this.slots[i];
       if(s.line===line&&(!oldest||s.serial<oldest.serial))oldest=s;
     }
     slot=oldest;
     if(!slot)return;
   }
   const obj=slot.obj;obj.visible=true;obj.material.color.set(color);obj.material.opacity=startOpacity??.8;obj.material.wireframe=wireframe;obj.material.blending=additive?T.AdditiveBlending:T.NormalBlending;obj.rotation.set(0,0,0);
   if(line){obj.position.copy(from);this.direction.subVectors(to,from);obj.scale.set(size,size,this.direction.length());obj.quaternion.setFromUnitVectors(this.axis,this.direction.normalize());}
   else{obj.position.copy(pos);obj.scale.setScalar(size);}
   let vel=null;
   if(velocity){
     slot.velVec??=new T.Vector3();
     slot.velVec.set(velocity.x||0,velocity.y||0,velocity.z||0);
     vel=slot.velVec;
   }
   let spinVec=null;
   if(spin){
     slot.spinVec??=new T.Vector3();
     if(typeof spin==='number')slot.spinVec.set(spin,spin*.7,spin*1.3);
     else slot.spinVec.set(spin.x||0,spin.y||0,spin.z||0);
     spinVec=slot.spinVec;
   }
   if(endColor){
     slot.startCol??=new T.Color();
     slot.endCol??=new T.Color();
     slot.startCol.set(color);
     slot.endCol.set(endColor);
     slot.startColor=slot.startCol;
     slot.endColor=slot.endCol;
   }else{
     slot.startColor=null;
     slot.endColor=null;
   }
   Object.assign(slot,{active:true,serial:++this.serial,life,total:life,expand,velocity:vel,spin:spinVec,damping:Math.max(0,Number(damping)||0),gravity,fade,startOpacity:startOpacity??.8});
   return obj;
  }
  update(dt){
   for(const s of this.slots){
    if(!s.active)continue;
    s.life-=dt;
    if(s.life<=0){s.active=false;s.obj.visible=false;continue;}
    const fraction=Math.max(0,Math.min(1,s.life/s.total));
    let alpha=fraction;
    if(s.fade==='smooth')alpha=fraction*fraction*(3-2*fraction);
    else if(s.fade==='exp')alpha=Math.pow(fraction,1.8);
    else if(s.fade==='pop')alpha=Math.sin(fraction*Math.PI*0.5);
    s.obj.material.opacity=s.startOpacity*alpha;
    if(s.endColor&&s.startColor){
     this.scratchColor.copy(s.endColor).lerp(s.startColor,fraction);
     s.obj.material.color.copy(this.scratchColor);
    }
    if(s.expand)s.obj.scale.addScalar(dt*s.expand);
    if(s.spin){
     s.obj.rotation.x+=s.spin.x*dt;
     s.obj.rotation.y+=s.spin.y*dt;
     s.obj.rotation.z+=s.spin.z*dt;
    }
    if(s.velocity){
     s.obj.position.addScaledVector(s.velocity,dt);
     if(s.damping>0)s.velocity.multiplyScalar(Math.exp(-s.damping*dt));
     s.velocity.y-=(s.gravity!=null?s.gravity:15)*dt;
    }
   }
  }
  clear(){for(const s of this.slots){s.active=false;s.obj.visible=false;s.velocity=null;s.spin=null;s.startColor=null;s.endColor=null;}}
  dispose(){for(const s of this.slots){this.scene.remove(s.obj);s.obj.material.dispose();}this.slots=[];this.line.dispose();this.sphere.dispose();}
}

// Deterministic ambient emitter that reuses the existing pooled effect system.
// Dust/leaves/embers drift around the camera, distant smoke rises from fixed
// arena anchors. Seeded so replays and the CPU renderer see identical spawns;
// the view only calls update() on WebGL and never under reduced motion.
const mulberry=seed=>{let state=(seed>>>0)||1;return()=>{state=(state+0x6d2b79f5)|0;let t=Math.imul(state^(state>>>15),1|state);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};};
export class AmbientFX{
 constructor(pool,{profile=null,seed=1,anchors=[],rateScale=1,moteCap=6}={}){this.pool=pool;this.profile=profile;this.anchors=Array.isArray(anchors)?anchors:[];this.rateScale=Math.max(0,Number(rateScale)||0);this.moteCap=Math.max(1,Math.round(moteCap)||1);this.seed=(seed>>>0)||1;this.random=mulberry(this.seed);this.acc=0;this.smokeAcc=0;this.spawned=0;}
 setProfile(profile){this.profile=profile||null;this.acc=0;this.smokeAcc=0;}
 setAnchors(anchors){this.anchors=Array.isArray(anchors)?anchors:[];}
 reset(){this.acc=0;this.smokeAcc=0;}
 update(dt,origin,{reduced=false,software=false,radius=9,wind=1}={}){
  if(reduced||software||!this.pool||!this.profile||!origin)return 0;
  const step=Math.min(Math.max(Number(dt)||0,0),.1),rate=Math.max(0,Number(this.profile.rate)||0)*this.rateScale;
  this.acc+=step*rate;
  let spawned=0;
  while(this.acc>=1&&spawned<this.moteCap){this.acc-=1;this._mote(origin,radius,wind);spawned++;}
  const smoke=this.profile.smoke;
  if(smoke&&this.anchors.length){this.smokeAcc+=step*Math.max(1,Number(smoke.rate)||1);while(this.smokeAcc>=1&&spawned<this.moteCap*2){this.smokeAcc-=1;this._smoke(smoke,wind);spawned++;}}
  this.spawned+=spawned;return spawned;
 }
 _mote(origin,radius,wind=1){
  const a=this.random()*Math.PI*2,dist=Math.sqrt(this.random())*Math.max(1,radius),height=this.random()*3.4,g=Number.isFinite(wind)&&wind>0?wind:1,drift=(this.profile.drift||.5)*g,rise=(this.profile.rise||0)*g;
  this.pool.add({pos:{x:(origin.x||0)+Math.cos(a)*dist,y:(origin.y||0)+height,z:(origin.z||0)+Math.sin(a)*dist},color:this.profile.color||'#c9d8e6',size:this.profile.size||.035,life:this.profile.life||3.5,velocity:{x:(this.random()-.5)*drift,y:rise*(.5+this.random()),z:(this.random()-.5)*drift},additive:this.profile.additive===true});
 }
 _smoke(smoke,wind=1){
  const anchor=this.anchors[Math.floor(this.random()*this.anchors.length)%this.anchors.length],g=Number.isFinite(wind)&&wind>0?wind:1;
  this.pool.add({pos:{x:(anchor.x||0)+(this.random()-.5)*1.2,y:(anchor.y||0)+.4,z:(anchor.z||0)+(this.random()-.5)*1.2},color:smoke.color||'#8f9a86',size:smoke.size||.3,life:smoke.life||6,expand:.4,velocity:{x:(this.random()-.5)*.2*g,y:(smoke.rise||.5)*g,z:(this.random()-.5)*.2*g},additive:true});
 }
}

// Deterministic precipitation emitter. Reuses the same pooled EffectPool as the
// ambient motes; the spawn list itself comes from the pure precipParticleAdds
// helper so replays match and the CPU renderer can skip the pass entirely.
export class WeatherFX{
 constructor(pool,{seed=1,preset=null,cap=10}={}){this.pool=pool;this.preset=preset;this.seed=(seed>>>0)||1;this.cap=Math.max(1,Math.round(Number(cap)||10));this.serial=0;this.spawned=0;}
 setPreset(preset){this.preset=preset||null;this.serial=0;return this.preset;}
 reset(){this.serial=0;this.spawned=0;}
 update(dt,origin,{reduced=false,software=false,radius=9,intensity=1,quality=1}={}){
  if(reduced||software||!this.pool||!this.preset||!(this.preset.particles>0)||!origin)return 0;
  this.serial=(this.serial+1)>>>0;
  const scale=Math.max(0,Math.min(1,Number(intensity)||0))*Math.max(0,Math.min(1,Number(quality)||0));
  if(scale<=0)return 0;
  const adds=precipParticleAdds(this.serial,this.preset.kind,origin,radius,{...this.preset,particles:Math.round(this.preset.particles*scale)});
  let spawned=0;
  for(const add of adds){if(spawned>=this.cap)break;this.pool.add(add);spawned++;}
  this.spawned+=spawned;return spawned;
 }
}

const REPORTS=[[320,.075,'square',65],[110,.2,'sawtooth',28],[1500,.16,'sine',180],[180,.13,'triangle',35],[620,.09,'triangle',250],[210,.18,'sawtooth',45],[480,.1,'square',1100],[95,.22,'triangle',30],[700,.09,'square',420],[540,.06,'square',180]];
// Per-weapon synthesis family: rifle snap, heavy thump, electric zap, wide burst, sharp crack, rapid chatter.
const GUN_STYLES=['rifle','heavy','zap','burst','plasma','heavy','zap','burst','sharp','rapid'];
// Optional announcer motifs keyed by mode event. Two-note rising/falling pairs
// keep the callouts distinct without a speech asset.
export const ANNOUNCE_CUES=Object.freeze({
 capture:Object.freeze({id:'capture',freq:520,mid:780,end:1040,length:.3}),
 'flag-pickup':Object.freeze({id:'flag-pickup',freq:640,mid:760,end:880,length:.24}),
 'flag-return':Object.freeze({id:'flag-return',freq:720,mid:640,end:560,length:.22}),
 goal:Object.freeze({id:'goal',freq:440,mid:880,end:1320,length:.42}),
 killstreak:Object.freeze({id:'killstreak',freq:620,mid:930,end:1240,length:.3}),
 spree:Object.freeze({id:'spree',freq:580,mid:870,end:1160,length:.35}),
 multikill:Object.freeze({id:'multikill',freq:780,mid:1170,end:1560,length:.3}),
 victory:Object.freeze({id:'victory',freq:660,mid:990,end:1320,length:.5}),
 defeat:Object.freeze({id:'defeat',freq:520,mid:410,end:300,length:.5}),
 score:Object.freeze({id:'score',freq:480,mid:600,end:720,length:.25}),
 boss:Object.freeze({id:'boss',freq:190,mid:140,end:96,length:.62}),
 objective:Object.freeze({id:'objective',freq:600,mid:750,end:900,length:.3}),
 power:Object.freeze({id:'power',freq:540,mid:720,end:960,length:.24}),
 feint:Object.freeze({id:'feint',freq:900,mid:600,end:320,length:.18}),
 // Movement verbs (§3.4/§6.3): one opt-in motif per verb, fired on activate.
 // `move-start` is the generic fallback when a verb id is unknown.
 'move-start':Object.freeze({id:'move-start',freq:560,mid:720,end:900,length:.2}),
 'air-dash':Object.freeze({id:'air-dash',freq:680,mid:1020,end:1360,length:.22}),
 'double-jump':Object.freeze({id:'double-jump',freq:620,mid:880,end:1240,length:.2}),
 'super-jump':Object.freeze({id:'super-jump',freq:240,mid:520,end:880,length:.3}),
 'hover-jets':Object.freeze({id:'hover-jets',freq:420,mid:640,end:840,length:.3}),
 'brace-slam':Object.freeze({id:'brace-slam',freq:180,mid:96,end:64,length:.4}),
 'safety-glide':Object.freeze({id:'safety-glide',freq:520,mid:460,end:400,length:.34}),
 grapple:Object.freeze({id:'grapple',freq:700,mid:1050,end:1400,length:.2}),
 'blink-step':Object.freeze({id:'blink-step',freq:880,mid:1320,end:1760,length:.16}),
 'deployable-rope':Object.freeze({id:'deployable-rope',freq:500,mid:750,end:1120,length:.26}),
 // High-value match beats (§announcer coverage). Each is a distinct two/three
 // note callout; the global cadence guard below keeps a cluster of beats from
 // stacking callouts.
 'zone-capture':Object.freeze({id:'zone-capture',freq:540,mid:810,end:1080,length:.32}),
 'objective-win':Object.freeze({id:'objective-win',freq:600,mid:900,end:1200,length:.44}),
 'sudden-death':Object.freeze({id:'sudden-death',freq:300,mid:260,end:200,length:.46}),
 'mission-won':Object.freeze({id:'mission-won',freq:660,mid:990,end:1320,length:.5}),
 'mission-lost':Object.freeze({id:'mission-lost',freq:520,mid:390,end:280,length:.5}),
 'horde-wave':Object.freeze({id:'horde-wave',freq:250,mid:330,end:440,length:.4}),
 'boss-phase':Object.freeze({id:'boss-phase',freq:210,mid:160,end:110,length:.5}),
 'vip-down':Object.freeze({id:'vip-down',freq:560,mid:420,end:300,length:.38}),
 'vip-extracted':Object.freeze({id:'vip-extracted',freq:620,mid:880,end:1180,length:.36}),
 'payload-delivered':Object.freeze({id:'payload-delivered',freq:480,mid:720,end:1080,length:.44}),
 'juggernaut-transfer':Object.freeze({id:'juggernaut-transfer',freq:380,mid:540,end:760,length:.42}),
 'armsrace-promote':Object.freeze({id:'armsrace-promote',freq:640,mid:960,end:1280,length:.28}),
 'armsrace-demote':Object.freeze({id:'armsrace-demote',freq:700,mid:520,end:360,length:.28}),
 'weapon-upgrade':Object.freeze({id:'weapon-upgrade',freq:760,mid:1140,end:1520,length:.24}),
 bounty:Object.freeze({id:'bounty',freq:580,mid:870,end:1160,length:.26}),
 'enemy-flank':Object.freeze({id:'enemy-flank',freq:940,mid:660,end:420,length:.22}),
 'enemy-artillery':Object.freeze({id:'enemy-artillery',freq:340,mid:280,end:220,length:.34}),
});
// Global cadence guard for the high-value announcer dispatch: after one callout
// lands, no other high-value callout may start within this window. The
// per-cue cooldown in announcerCue still dedupes duplicate reports of one beat.
export const ANNOUNCE_CADENCE=1.2;
// The high-value event types routed through announcerEvent(). Types that are
// actor-scoped are announced for the local player only so a remote enemy's
// upgrade/bounty never reads as the local player's beat.
const HIGH_VALUE_ANNOUNCE=Object.freeze({
 'zone-capture':false,'objective-win':false,'sudden-death':false,'mission-won':false,'mission-lost':false,
 'horde-wave':false,'boss-phase':false,'vip-down':false,'vip-extracted':false,'payload-delivered':false,
 'juggernaut-transfer':false,'enemy-flank':false,'enemy-artillery':false,
 'armsrace-promote':true,'armsrace-demote':true,'weapon-upgrade':true,bounty:true,
});
const cl=(n,a,b)=>Math.max(a,Math.min(b,n));

// Per-mode music themes. A theme is a root frequency plus a small scale (in
// semitones) reused for the dynamic combat drone and the victory/defeat sting,
// so a mode has a recognisable tonal centre without a music asset. Pure data.
export const MODE_THEMES=Object.freeze({
 default:Object.freeze({root:58,scale:Object.freeze([0,3,5,7])}),
 deathmatch:Object.freeze({root:62,scale:Object.freeze([0,3,5,7])}),
 teamdeathmatch:Object.freeze({root:58,scale:Object.freeze([0,3,5,7])}),
 ctf:Object.freeze({root:55,scale:Object.freeze([0,4,7,9])}),
 koth:Object.freeze({root:52,scale:Object.freeze([0,5,7,10])}),
 domination:Object.freeze({root:57,scale:Object.freeze([0,4,7,11])}),
 assault:Object.freeze({root:50,scale:Object.freeze([0,3,7,10])}),
 payload:Object.freeze({root:53,scale:Object.freeze([0,5,7,10])}),
 instagib:Object.freeze({root:66,scale:Object.freeze([0,6,8,12])}),
 rockets:Object.freeze({root:48,scale:Object.freeze([0,3,6,9])}),
 arsenal:Object.freeze({root:60,scale:Object.freeze([0,4,7,9])}),
 armsrace:Object.freeze({root:64,scale:Object.freeze([0,2,5,9])}),
 'combined-arms':Object.freeze({root:51,scale:Object.freeze([0,4,7,10])}),
 'puma-race':Object.freeze({root:69,scale:Object.freeze([0,4,7,12])}),
 'puma-soccer':Object.freeze({root:67,scale:Object.freeze([0,4,7,11])}),
 horde:Object.freeze({root:46,scale:Object.freeze([0,1,5,8])}),
 campaign:Object.freeze({root:54,scale:Object.freeze([0,3,7,10])}),
 juggernaut:Object.freeze({root:49,scale:Object.freeze([0,3,6,10])}),
 'team-elimination':Object.freeze({root:45,scale:Object.freeze([0,1,6,8])}),
 'vip-escort':Object.freeze({root:56,scale:Object.freeze([0,4,7,9])}),
 holdout:Object.freeze({root:55,scale:Object.freeze([0,3,5,7])}),
 uplink:Object.freeze({root:63,scale:Object.freeze([0,4,7,11])}),
 // LATTICE STRIKE family: the same tonal world as the node lattice with a
 // brighter command line for PvPvE and a darker siege line for Operations.
 cocs:Object.freeze({root:57,scale:Object.freeze([0,5,7,10])}),
 'cocs-coop':Object.freeze({root:50,scale:Object.freeze([0,3,6,10])}),
});
// Victory/defeat stings: a short arpeggio built from the active mode scale.
const STING_CUES=Object.freeze({
 victory:Object.freeze({type:'triangle',octave:4,step:.12,length:.6,gain:.06,end:1.5,notes:Object.freeze([0,2,4,7])}),
 defeat:Object.freeze({type:'sawtooth',octave:2,step:.15,length:.62,gain:.055,end:.5,notes:Object.freeze([4,2,1,0])}),
});

// Objective / match-beat motifs in semitone offsets from the active mode root.
// One motif is one voice (one `_play` token) so a busy objective does not spend
// the shared voice budget. `gain`/`length` are the tone envelope, `step` the
// note spacing, `shimmer` adds a filtered noise accent.
const objective=(notes,step,length,gain,shimmer=false)=>Object.freeze({notes:Object.freeze(notes),step,length,gain,shimmer});
const OBJECTIVE_CUES=Object.freeze({
 pickup:objective([0,7],.06,.2,.08),
 powerup:objective([0,5,12],.05,.2,.075),
 power:objective([7,12],.07,.22,.08),
 spawn:objective([7],0,.2,.06),
 'flag-pickup':objective([0,4,7],.05,.18,.075),
 'flag-drop':objective([7,0],.05,.16,.07),
 'flag-return':objective([12,7,4],.05,.18,.075),
 capture:objective([0,7,12],.06,.22,.085),
 zone:objective([0,5,12],.05,.18,.07),
 default:objective([0,7],.06,.2,.075),
});
const objectiveCue=type=>OBJECTIVE_CUES[type]||(typeof type==='string'&&type.startsWith('zone')?OBJECTIVE_CUES.zone:OBJECTIVE_CUES.default);

// Per-kind supply pickup motifs. Health and armor are warm and metallic; ammo
// is a mechanical click motif and a weapon pickup opens into the weapon's own
// register. Pure data, one motif per beat, and an unknown kind keeps the
// historical generic pickup cue.
export const PICKUP_CUES=Object.freeze({
 health:objective([0,4,7],.05,.18,.075),
 armor:objective([0,5],.06,.18,.07),
 ammo:objective([0,7],.04,.14,.06),
 megahealth:objective([0,7,12],.05,.2,.08),
 weapon:objective([0,5,12],.05,.18,.07),
});
export function pickupCue(kind){
 const key=String(kind??'');
 if(key==='health'||key==='armor'||key==='ammo'||key==='megahealth')return PICKUP_CUES[key];
 return key?PICKUP_CUES.weapon:OBJECTIVE_CUES.pickup;
}

// Final-ten-seconds tension pulse. One motif, one voice, fired once per match.
const FINAL_CUE=objective([0,-1,0,-1],.1,.22,.075);
// Match-start FIGHT sting: a short major fanfare with a low impact body.
const FIGHT_CUE=Object.freeze({notes:Object.freeze([0,7,12]),step:.16,length:.22,gain:.11});

// Optional short second layer for a `power` activation: a quiet tail/impact so
// the harness reads as a bigger moment. It plays inside the motif's single
// `_play` token and is deliberately bounded well under the motif's own level.
const motifTail=(freq,gain,{end=freq*.5,type='sine',delay=.06,duration=.18,noise=0,noiseSweep=0,noiseGain=.03}={})=>Object.freeze({freq,end,gain,type,delay,duration,noise,noiseSweep:noiseSweep||Math.max(60,noise*.4),noiseGain});
// A motif plus its activation tail. Notes/step/length/gain/shimmer keep the
// exact per-harness values; only the new tail layer is added.
const activation=(notes,step,length,gain,tail,shimmer=false)=>Object.freeze({notes:Object.freeze(notes),step,length,gain,shimmer,tail});

// Per-harness activation motifs (§6.3). The `power` event already carries the
// harness id, so an activation reads as the spec that fired instead of one
// generic power blip. One motif is still one `_play` voice.
export const POWER_CUES=Object.freeze({
 openclaw:activation([0,-3,0],.06,.22,.09,motifTail(170,.05,{end:88,type:'triangle',delay:.08,noise:420,noiseGain:.03})),
 hermes:activation([0,5,12],.05,.18,.08,motifTail(560,.045,{end:940,type:'sine',delay:.05,noise:1900,noiseGain:.026})),
 opencode:activation([0,4,7,12],.04,.16,.075,motifTail(1320,.04,{end:880,type:'square',delay:.06,duration:.14,noise:2400,noiseGain:.022})),
 claudecode:activation([0,-5],.08,.26,.08,motifTail(112,.055,{end:70,type:'triangle',delay:.09,noise:300,noiseGain:.032})),
 codex:activation([0,7,12],.06,.24,.085,motifTail(1560,.045,{end:1040,type:'triangle',delay:.07,noise:3200,noiseGain:.024})),
 cline:activation([12,5,0],.04,.14,.075,motifTail(880,.04,{end:660,type:'square',delay:.05,duration:.13,noise:1400,noiseGain:.028})),
 roo:activation([0,-1,-5],.07,.24,.08,motifTail(240,.05,{end:120,type:'sawtooth',delay:.08,noise:700,noiseGain:.032}),true),
});

// Per-kind enemy telegraph motifs. The sim's `enemy-telegraph` events carry the
// unit `kind` (overseer/mender/flanker/phalanx/sapper/artillery/boss) plus the
// world position as `x`/`z`, so each windup reads as a distinct one-voice motif
// instead of a generic blip; an unknown or missing kind keeps the generic
// fallback (the historical two-note square voice, now a motif). One cue is one
// `_play` token, retuned to the active mode root like the other match beats.
export const TELEGRAPH_CUES=Object.freeze({
 overseer:objective([0,-3,2],.07,.2,.07,true),
 mender:objective([0,4],.06,.18,.06),
 flanker:objective([12,5,9],.06,.16,.065),
 phalanx:objective([0,-5],.09,.22,.075),
 sapper:objective([-12,-7,0],.08,.2,.08),
 artillery:objective([12,11],.1,.24,.075),
 boss:objective([0,-7,-12],.11,.28,.085,true),
 generic:objective([0,-2],.08,.2,.065),
});

// The movement module's shared event vocabulary (§3.6). Movement foley is
// local-only: these are the verbs the local player is driving, not world beats.
const MOVEMENT_EVENTS=new Set(['move-start','move-end','move-miss','move-blocked','windup-start','windup-end','windup-interrupt','charge-start','charge-release','charge-cancel','slam-launch','slam-impact','grapple-hook','grapple-release','rope-place','rope-miss','rope-expire','fuel-empty','no-lift','chain-cancel','landing-recovery']);
// Verb ids the per-verb foley layer can identify. An event without one of these
// (or without a verb field at all) keeps the generic per-type fallback voice.
const MOVEMENT_VERBS=new Set(['air-dash','double-jump','super-jump','hover-jets','brace-slam','safety-glide','grapple','blink-step','deployable-rope']);

// Match-beat motifs keyed by mode event type, in semitones from the mode root.
// These cover objective ticks, wave/boss beats and lifetime events that used to
// be silent. One motif is still one `_play` voice.
const EVENT_CUES=Object.freeze({
 'zone-score':objective([0,4,7],.05,.16,.055),
 'zone-progress':objective([0,4],.05,.14,.045),
 'zone-contested':objective([0,-1,0],.07,.18,.05),
 'zone-capture':objective([0,7,12],.06,.2,.07,true),
 'zone-neutralized':objective([12,7,0],.05,.18,.06),
 'charge':objective([0,5],.07,.2,.06),
 'assault-hold':objective([0,7],.08,.22,.06),
 'payload-hold':objective([0,5],.08,.22,.06),
 'hill-rotate':objective([7,12],.07,.2,.06),
 'uplink-capture':objective([0,7,12],.05,.2,.07,true),
 'uplink-stage':objective([0,5],.07,.18,.055),
 'objective-win':objective([0,7,12],.09,.3,.085,true),
 'objective-tiebreak':objective([0,6,12],.08,.28,.08),
 'sudden-death':objective([0,-1,0],.12,.3,.08),
 'horde-wave':objective([0,-5],.1,.3,.075),
 'horde-wave-cleared':objective([0,5,12],.07,.24,.075,true),
 'horde-resupply':objective([0,7],.06,.2,.07),
 'boss-summon':objective([0,-6],.14,.4,.09),
 'boss-slam':objective([-12,0],.06,.34,.1),
 'boss-phase':objective([0,-3,-6],.12,.34,.085,true),
 'mender-heal':objective([0,4,7],.04,.14,.05),
 'weapon-upgrade':objective([0,5,7,12],.045,.14,.055,true),
 'armsrace-promote':objective([0,5,12],.05,.16,.06),
 'armsrace-demote':objective([12,5,0],.05,.16,.055),
 'bounty':objective([0,7,0],.05,.16,.06),
 'vip-deploy':objective([0,7],.08,.22,.065),
 'vip-down':objective([7,0,-5],.08,.24,.075),
 'vip-extracted':objective([0,7,12],.07,.24,.08,true),
 'elimination-life':objective([0,-3],.1,.26,.07),
 'singleplayer-life':objective([0,-3],.1,.26,.07),
 'campaign-resupply':objective([0,7],.06,.2,.07),
 'enemy-flank':objective([12,5,12],.11,.24,.07,true),
 // Assault / payload / horde beats that previously fell through the cue table.
 'assault-sector-captured':objective([0,7,12],.06,.22,.07,true),
 'assault-sector-lost':objective([12,7,0],.06,.22,.065),
 'assault-breach':objective([0,-1,0],.1,.3,.085,true),
 'payload-checkpoint':objective([0,5,12],.06,.22,.07),
 'payload-delivered':objective([0,7,12,17],.07,.3,.085,true),
 'horde-upgrade':objective([0,5,12],.05,.16,.06,true),
 'horde-upgrade-selected':objective([0,7],.05,.16,.06),
 'horde-modifier':objective([0,-1],.12,.26,.06),
 'juggernaut-transfer':objective([0,-5,12],.08,.28,.08,true),
 'loadout-switch':objective([0,3,7],.06,.2,.055),
 'threat-ping':objective([12,19],.04,.12,.06,true),
 'mission-won':objective([0,4,7,12],.09,.3,.085,true),
 'mission-lost':objective([0,-3,-7],.1,.3,.075),
 // Beats that previously fell through the cue table: the overseer's aura pulse,
 // the LATTICE support tick, weather/time onset cues and the new gameplay
 // repair/destroy events (all emitted with x/z or no position at all).
 'overseer-aura':objective([0,-5,2],.06,.2,.065,true),
 'lattice-support':objective([0,5,7],.05,.18,.06,true),
 'weather-change':objective([0,-5,7],.07,.24,.065,true),
 'time-change':objective([0,5,12],.08,.26,.06),
 'vehicle-repair':objective([0,5,7],.05,.18,.055),
 'deployable-destroyed':objective([7,3,-2],.07,.2,.065),
 'deployable-repaired':objective([0,4,7],.05,.16,.05),
 'deployable-fire':objective([12,7],.04,.1,.045),
});

// Layered Web Audio synth: filtered noise transients + tonal bodies, distance
// falloff and stereo panning, plus footsteps, landing thuds and a Warthog engine.
// Continuous ambience bed profiles keyed by biome mood. Frequencies and gains
// are presentation-only; setBedMood eases between them without restarting nodes.
const BED_MOODS=Object.freeze({
 default:Object.freeze({filter:240,tone:42,gain:.018,sub:.006,air:.0045,windFreq:520,wind:1,tense:.004,tenseFreq:58}),
 night:Object.freeze({filter:180,tone:34,gain:.014,sub:.005,air:.003,windFreq:420,wind:.8,tense:.005,tenseFreq:52}),
 cold:Object.freeze({filter:320,tone:54,gain:.016,sub:.004,air:.006,windFreq:760,wind:1.15,tense:.003,tenseFreq:64}),
 hot:Object.freeze({filter:200,tone:38,gain:.02,sub:.008,air:.005,windFreq:600,wind:1.1,tense:.004,tenseFreq:55}),
 storm:Object.freeze({filter:420,tone:48,gain:.024,sub:.005,air:.012,windFreq:900,wind:2,tense:.003,tenseFreq:60}),
});
// Precipitation noise presence keyed by weather kind. One looped noise source
// per active kind on the ambience bus: rain/storm hiss, a low ash hush and a
// soft snow air. Frequencies and gains are presentation-only.
const PRECIP_BEDS=Object.freeze({
 rain:Object.freeze({kind:'rain',type:'bandpass',freq:2600,q:.35,gain:.019}),
 storm:Object.freeze({kind:'storm',type:'bandpass',freq:2200,q:.35,gain:.026}),
 ash:Object.freeze({kind:'ash',type:'lowpass',freq:640,q:.6,gain:.012}),
 snow:Object.freeze({kind:'snow',type:'highpass',freq:900,q:.4,gain:.007}),
});

// Continuous engine timbres keyed by the snapshot vehicle `kind`. Every profile
// keeps the same bounded parameter surface (two-oscillator body plus a filtered
// boost overtone) so the graph stays one long-lived node set per vehicle, never
// one node per frame. `default` reproduces the historical engine numbers
// exactly (no gear banding) so an unknown kind keeps the legacy voice; the
// authored kinds add gear-shift banding (`gearBand` per gear, `gearSpan`
// inside it) and raise/lower the body. `skid` marks the chassis that owns the
// eased lateral-slip loop (Puma).
const engine=(o)=>Object.freeze(o);
export const ENGINE_PROFILES=Object.freeze({
 default:engine({osc:'sawtooth',sub:'triangle',base:55,span:120,subBase:28,subSpan:40,filter:500,filterSpan:1200,gain:.022,gainSpan:.05,gears:1,gearBand:0,gearSpan:0,boostPitch:1.35,boostGain:1.2,boostFilter:1.4,skid:false}),
 puma:engine({osc:'sawtooth',sub:'triangle',base:58,span:128,subBase:29,subSpan:42,filter:540,filterSpan:1150,gain:.023,gainSpan:.052,gears:4,gearBand:.22,gearSpan:.5,boostPitch:1.32,boostGain:1.18,boostFilter:1.45,skid:true}),
 hornet:engine({osc:'square',sub:'sawtooth',base:74,span:150,subBase:38,subSpan:52,filter:760,filterSpan:1500,gain:.02,gainSpan:.046,gears:5,gearBand:.18,gearSpan:.42,boostPitch:1.4,boostGain:1.16,boostFilter:1.55,skid:false}),
 titan:engine({osc:'sawtooth',sub:'triangle',base:42,span:88,subBase:21,subSpan:30,filter:380,filterSpan:860,gain:.027,gainSpan:.06,gears:3,gearBand:.3,gearSpan:.6,boostPitch:1.24,boostGain:1.24,boostFilter:1.32,skid:false}),
 scout:engine({osc:'triangle',sub:'sine',base:88,span:170,subBase:44,subSpan:60,filter:880,filterSpan:1800,gain:.017,gainSpan:.04,gears:5,gearBand:.16,gearSpan:.38,boostPitch:1.45,boostGain:1.14,boostFilter:1.6,skid:false}),
 transport:engine({osc:'square',sub:'triangle',base:48,span:96,subBase:24,subSpan:34,filter:430,filterSpan:940,gain:.025,gainSpan:.055,gears:4,gearBand:.26,gearSpan:.54,boostPitch:1.28,boostGain:1.2,boostFilter:1.38,skid:false}),
});
// Pure engine voice resolver: deterministic in (kind, speed, boosting) with no
// nodes, so tests and replays can pin the gear banding without a context.
export function engineVoice(kind,speed,boosting=false){
 const profile=ENGINE_PROFILES[kind]||ENGINE_PROFILES.default;
 const s=cl((Number(speed)||0)/20,0,1),gears=Math.max(1,Math.round(profile.gears||1));
 const gear=Math.min(gears-1,Math.floor(s*gears)),within=gears>1?cl(s*gears-gear,0,1):0;
 const band=1+gear*(profile.gearBand||0)+within*(profile.gearSpan||0),boost=boosting===true;
 return Object.freeze({
  kind:ENGINE_PROFILES[kind]?kind:'default',profile,gear,gears,speed:s,
  oscFreq:cl((profile.base+s*profile.span)*band*(boost?profile.boostPitch:1),20,6000),
  subFreq:cl((profile.subBase+s*profile.subSpan)*band*(boost?profile.boostPitch:1),15,3000),
  filterFreq:cl((profile.filter+s*profile.filterSpan)*(boost?profile.boostFilter:1),60,16000),
  gain:Math.max(.0004,(profile.gain+s*profile.gainSpan)*(boost?profile.boostGain:1)),
 });
}
// Distant thunder recipes. Recipe 0 is the historical roll, kept bit-for-bit, so
// a caller that supplies no seed hears exactly the old strike. A seed picks one
// of the frozen variants deterministically through mixUnit; all three keep the
// same layer roles, only their frequencies/sweeps/levels move.
const thunderRecipe=(o)=>Object.freeze(o);
export const THUNDER_RECIPES=Object.freeze([
 thunderRecipe({crack:.45,bodyFreq:420,bodyDrop:220,bodySweep:70,bodyRise:40,bodyGain:.42,rollFreq:180,rollSweep:60,rollGain:.2,tailFreq:300,tailDrop:80,tailSweep:120,tailGain:.12,lowFreq:52,lowDrop:12,lowGain:.3,highFreq:38,highDrop:8,highGain:.14,durScale:.5}),
 thunderRecipe({crack:.32,bodyFreq:300,bodyDrop:160,bodySweep:52,bodyRise:30,bodyGain:.5,rollFreq:150,rollSweep:48,rollGain:.22,tailFreq:220,tailDrop:60,tailSweep:86,tailGain:.14,lowFreq:44,lowDrop:9,lowGain:.32,highFreq:31,highDrop:6,highGain:.15,durScale:.55}),
 thunderRecipe({crack:.6,bodyFreq:560,bodyDrop:300,bodySweep:96,bodyRise:52,bodyGain:.36,rollFreq:230,rollSweep:78,rollGain:.16,tailFreq:380,tailDrop:110,tailSweep:150,tailGain:.1,lowFreq:62,lowDrop:15,lowGain:.26,highFreq:46,highDrop:11,highGain:.12,durScale:.42}),
]);
export function thunderRecipeFor(seed){
 if(seed==null)return THUNDER_RECIPES[0];
 const n=Number(seed);
 if(!Number.isFinite(n))return THUNDER_RECIPES[0];
 // A multiplicative step first: mixUnit alone keeps the near-identical high
 // bits of sequential small seeds, which would starve the later recipes.
 return THUNDER_RECIPES[Math.floor(mixUnit(Math.imul(n>>>0,2654435761)>>>0)*THUNDER_RECIPES.length)%THUNDER_RECIPES.length];
}

// ---- Death sound families --------------------------------------------------
//
// The sim stamps each death with the planner's style (deaths.mjs) and the
// planner owns the style -> `sound` recipe. A stream may also ship a ready-made
// `sound`; otherwise the table below maps the style the stream already carries
// and, when even that is missing, the same kill context is replayed through the
// planner. Anything absent or junk resolves to null, which keeps the legacy
// death voice. feedback.test.mjs probes the planner so this table can never
// drift from RECIPES unnoticed.
export const DEATH_SOUND_FAMILIES=Object.freeze(['thud','pop','splat','burst','boom','zap']);
export const DEATH_STYLE_SOUNDS=Object.freeze({
 ragdoll:'thud',headpop:'pop',gibs:'splat',burst:'burst',combust:'boom',vaporize:'zap',
 splatter:'splat',electrocute:'zap',crumple:'thud',spinout:'thud',collapse:'thud',
});
const DEATH_SOUND_SET=new Set(DEATH_SOUND_FAMILIES);
// Bounded voice length per family so every variant is short; the default keeps
// the historical .6 s death token.
const DEATH_VOICE_DURATIONS=Object.freeze({thud:.5,pop:.32,splat:.55,burst:.52,boom:.75,zap:.36});
// Resolve the family a death event should voice. Only existing event fields are
// read: optional `sound`, the planner `style`, then the planner kill context.
export function deathSoundFor(e){
 if(!e||typeof e!=='object')return null;
 if(typeof e.sound==='string'&&DEATH_SOUND_SET.has(e.sound))return e.sound;
 const style=typeof e.style==='string'?e.style:null;
 if(style&&DEATH_STYLE_SOUNDS[style])return DEATH_STYLE_SOUNDS[style];
 // Replays or pre-style events can recover the family from the same context the
 // sim used; an empty context never guesses a family.
 if(Number.isInteger(e.weapon)||e.fall===true){
  const plan=deathPlan({weapon:Number.isInteger(e.weapon)?e.weapon:null,overkill:e.overkill,fall:e.fall===true,seed:Number.isFinite(Number(e.seed))?Number(e.seed):0,headshot:e.headshot===true});
  if(DEATH_SOUND_SET.has(plan.sound))return plan.sound;
 }
 return null;
}
// ---- Alt-fire voices -------------------------------------------------------
//
// Ten alt-fire weapon voices keyed by the ids `game/alt-fire.mjs` stamps on the
// event (`altId`, mirrored by each spec's `sound` field). The indexed list below
// matches ALT_FIRE's weapon order; feedback.test.mjs pins the two tables to each
// other so they cannot drift. Each voice replaces the normal report in a single
// short (≤.4 s) `_play` token, with pitch/level micro-variation taken only from
// the event seed so identical events synthesize identically.
export const ALT_VOICE_IDS=Object.freeze(['salvo','cluster','overload','slug','mortar','mine','chain','bomb','double','twin']);
const ALT_VOICE_SET=new Set(ALT_VOICE_IDS);
const ALT_VOICE_DURATIONS=Object.freeze({salvo:.3,cluster:.4,overload:.4,slug:.34,mortar:.36,mine:.32,chain:.3,bomb:.34,double:.32,twin:.3});

// Resolve the alt voice an event should use. `alt` gates the alt path; a known
// `altId` wins, then the weapon index (`ALT_VOICE_IDS[weapon]`, ALT_FIRE's
// order). Anything missing or unknown resolves to null, so the caller can fall
// back to the normal report instead of guessing a voice.
export function altVoiceFor(e){
 if(!e||typeof e!=='object')return null;
 if(e.alt!==true&&e.alt!==1)return null;
 const id=typeof e.altId==='string'?e.altId:null;
 if(id&&ALT_VOICE_SET.has(id))return id;
 const weapon=Number.isInteger(e.weapon)?e.weapon:-1;
 const fallback=weapon>=0&&weapon<ALT_VOICE_IDS.length?ALT_VOICE_IDS[weapon]:null;
 return fallback&&ALT_VOICE_SET.has(fallback)?fallback:null;
}

// Deterministic per-voice pitch/level, driven only by the event seed and bounded
// tight enough that no alt voice can drift loud or off-family.
function altVariation(seed){
 const s=(Number(seed)||0)>>>0;
 return Object.freeze({pitch:1+(mixUnit(s^0x9e3779b9)-.5)*.12,level:.94+mixUnit(s^0x85ebca6b)*.08});
}

// ---- Event-driven music -----------------------------------------------------
//
// The soundtrack reacts to beats the simulation already emits. Every hook is
// either pure state (tension/escalation) or a queued harmonic response, so the
// single-owner rule holds: one beat is voiced by exactly one of the motif
// (`_beat`), the announcer, or the music. `_claimMusicBeat` makes each event id
// idempotent across replays and repeated frames. Unknown event types are
// ignored, and with music off/muted every hook falls back to the historical
// motif voice untouched.
//
// Escalation floors: a horde wave steps the level up by one, boss beats jump to
// at least 2/3 and sudden death pins 3. The LATTICE Operations director's own
// escalation/boss/phase beats map to the same ladder. Clears release back to 0.
const ESCALATION_EVENTS=Object.freeze({
 'horde-wave':Object.freeze({step:1,floor:1}),
 'director-escalation':Object.freeze({step:1,floor:1}),
 'boss-summon':Object.freeze({step:0,floor:2}),
 'boss-slam':Object.freeze({step:0,floor:2}),
 'director-boss':Object.freeze({step:0,floor:2}),
 'boss-phase':Object.freeze({step:0,floor:3}),
 'director-phase':Object.freeze({step:0,floor:3}),
 'director-overrun':Object.freeze({step:0,floor:3}),
 'sudden-death':Object.freeze({step:0,floor:3}),
});
const ESCALATION_CLEARS=Object.freeze(['horde-wave-cleared','director-wave-cleared','objective-win','mission-won','holdout-win','uplink-win']);
// Killstreak-family moments: the music accent only fills in when the optional
// announcer is off, because the announcer callout owns that beat otherwise.
const ACCENT_EVENTS=Object.freeze(['killstreak','multikill','spree']);
// Objective beats the soundtrack can answer harmonically. Capture-family beats
// resolve upward, loss-family beats downward; each is quantised to the next
// music step by the engine's response queue.
const HARMONIC_RESPONSES=Object.freeze({
 capture:'capture','zone-capture':'capture','assault-sector-captured':'capture','payload-delivered':'capture','uplink-capture':'capture','objective-win':'capture','flag-return':'capture',
 'assault-sector-lost':'loss','vip-down':'loss','mission-lost':'loss','elimination-life':'loss',
});

export class SynthAudio{
 constructor({announcer=false}={}){this.ctx=null;this.muted=false;this.voices=new Set();this.noiseBuffer=null;this.master=null;this.lastDamage=null;this.lastReport=null;this.lastHit=-Infinity;this.footPhase=0;this.wasGrounded=undefined;this.lastVy=0;this.engine=null;this.zipLoop=null;this.bed=null;this.bedMood='default';this.ambientBed=true;this.stepVariant=0;this.landVariant=0;this.reloadVariant=0;this.intensity=0;this.bedScale=.75;this.musicEnabled=true;this.announcer=announcer===true;this.announced=new Set();this.lastCue=null;this.mode='default';this.theme=MODE_THEMES.default;this.soundtrack='default';this.reverbUrl=null;this.reverbWet=0.30;this.reverbLoaded=false;this.reverbSpace=null;this.lastSting=null;this.heartbeatTimer=0;this.reportSerial=0;this.space=null;this.surfaceResolver=null;this.windScale=null;this._reverbPending=false;this.jumpVariant=0;
  // Gain buses. `muteGain` sits between the master and the destination so a
  // master mute silences every branch immediately; music/effects/ambience each
  // have their own bus for independent volume control. Voice chat lives in
  // game/voice.mjs and is deliberately outside this graph.
  this.musicEngine=null;this.musicBus=null;this.effectsBus=null;this.ambienceBus=null;this.muteGain=null;
  // Optional master tone stage: a biquad plus a mix gain inserted between the
  // master gain and the mute gain. Neutral by default (wide-open cutoff, unity
  // level) so a context that builds it sounds identical to the legacy graph;
  // health, killcam and spectating ease it. When the context cannot build a
  // biquad the chain falls back to master -> mixGain -> muteGain; when even
  // that fails, the historical master -> muteGain link is kept.
  this.masterFilter=null;this.mixGain=null;this._mixCutoff=20000;this._mixLevel=1;this.healthMix=1;
  this.killcam=false;this.spectating=false;
  this.volumes={master:.9,music:.7,effects:1,ambience:.8};
  this.status='off';this.scene='menu';this._announceAt=new Map();this._stingDuckTimer=null;
  // Bounded dynamic-mix state: the music duck level/timer, the high-value
  // announcer cadence stamp, the weather/time onset dedupe keys and the shell
  // casing cadence stamp. All reset on dispose.
  this._musicDuck=0;this._musicDuckTimer=null;this._announceCadence=null;
  this._weatherCueKind=null;this._timeCuePhase=null;this._shellAt=null;this.skidLoop=null;
  // Last held alt-fire state per actor, so an alt-state stream that repeats the
  // current state cannot re-trigger the transform foley. Bounded like the
  // announcer dedupe map; the sim only emits on flips, this is belt-and-braces.
  this._altStates=new Map();
  // Sampled announcer voice pack (public/audio/announcer). URL-backed and
  // optional: the manifest loads once the graph exists, takes decode on first
  // use, and any fetch/decode failure leaves the procedural cue in charge.
  this.announcerPack=null;this._announcerPackPromise=null;this._announcerTake=0;
  this._announcerVoiceUntil=0;this.announcerFetch=null;this.announcerGain=.9;
  this.announcerPackUrl='/audio/announcer/manifest.json';this.announcerPackBase='/audio/announcer';
  // Optional Moth audio layer (game/moth-audio.mjs). Never created here; the
  // host opts in with setMothAudio() or registers a factory with
  // setMothAudioFactory() so the layer is built once a real AudioContext exists.
  // All forwarding is guarded so an absent layer is a no-op and this stays
  // merge-friendly with the music work.
  this.mothAudio=null;this.mothAudioFactory=null;this.mothEnabled=true;
  // Baked echo/tap map applied to the shared effects send (gunfire/explosions).
  this.echoMap=null;
  // Biome/weather ambience routing and the precipitation noise presence.
  // `weather` is the active override kind (null under clear skies) and
  // `biomeMood` the arena fallback the bed drops to when no weather mood wins.
  this.weather=null;this.biomeMood='default';this.precip=null;
  // Match-start / countdown / final-call edge state. Everything is driven by the
  // host's snapshot or the event stream, never by a page timer, and each key is
  // idempotent so a reconnect or replay cannot double-fire.
  this._matchLive=false;this._matchKey=null;this._countdown={phase:null,beat:0};this._finalWarned=false;
  // Bounded state for the throttled LATTICE HQ warning and the KOTH/domination
  // progress quantizer. Both maps are pruned oldest-first.
  this._latticeAudioState=createLatticeAudioState();this._zoneAudio=new Map();
  // Pending per-weapon mag-in clicks and the vehicle hull-hit throttle.
  this._reloadPending=new Map();this._vehicleHitAt=new Map();
  // Timestamp of the last centered local damage thud, so a same-frame
  // `hitDirection` adds a panned accent instead of a second full thud.
  this._lastLocalDamageAt=null;
  // Shared effects glue (compressor + soft clip) inserted before the effects
  // master; an array of nodes so disposal can release every stage.
  this.effectsGlue=null;
  // The motif that was active before a victory/defeat take, restored when the
  // outcome clears.
  this._motifBeforeOutcome=null;
  // Dynamic music state forwarded to the soundtrack: tension 0..1 (low-string
  // danger layer), escalation 0..3 (short-form/faster mode) and the last mode
  // palette selected. Pure state, applied by the engine's scheduler only.
  this.tension=0;this.escalation=0;this._lowHealthTension=0;
  // Last seeded-variation request (string key or integer id); re-applied when a
  // deferred music engine is built on the first user gesture.
  this.variationKey=null;
  // Bounded per-event-id dedupe for the event-driven music hooks, so a replayed
  // or repeated event can never fire the accent/escalation twice.
  this._musicBeats=new Set();
 }
 // Attach (or clear) a MothAudio instance and seed it with the current state.
 // Additive and inert without an instance; returns the layer for chaining.
 setMothAudio(audio){
  this.mothAudio=audio||null;
  if(this.mothAudio){try{this.mothAudio.setEnabled?.(this.mothEnabled);this.mothAudio.setScene?.(this.scene);this.mothAudio.setIntensity?.(this.intensity);this.mothAudio.setBedMood?.(this.bedMood);this.mothAudio.setWeather?.(this.weather);}catch{}}
  return this.mothAudio;
 }
 // Deferred mount: the Moth layer needs a live AudioContext, which the host
 // creates on its first user gesture (start()). The host registers a factory
 // that runs exactly once, as soon as the context and its buses exist, and the
 // built layer is attached with setMothAudio(). Inert when no factory is set.
 setMothAudioFactory(factory){
  this.mothAudioFactory=typeof factory==='function'?factory:null;
  return this._ensureMothAudio();
 }
 _ensureMothAudio(){
  if(this.mothAudio||typeof this.mothAudioFactory!=='function'||!this.ctx)return this.mothAudio;
  const factory=this.mothAudioFactory;this.mothAudioFactory=null;
  let built=null;
  try{built=factory(this.ctx,this)||null;}catch{built=null;}
  if(built)this.setMothAudio(built);else this.mothAudio=null;
  return this.mothAudio;
 }
 // Runtime gate forwarded to the layer (reduced motion / constrained hosts).
 setMothEnabled(on){
  this.mothEnabled=on!==false;
  this.mothAudio?.setEnabled?.(this.mothEnabled);
  if(this.mothEnabled&&this.mothAudio){try{this.mothAudio.setScene?.(this.scene);this.mothAudio.setIntensity?.(this.intensity);this.mothAudio.setBedMood?.(this.bedMood);this.mothAudio.setWeather?.(this.weather);}catch{}}
  return this.mothEnabled;
 }
 mothAudioStatus(){return this.mothAudio?.status?.()??null;}
 // Start (or resume) the audio engine. Returns a promise that resolves once the
 // context is running; a rejected/blocked resume is surfaced through `status`
 // rather than swallowed so the UI can offer a retry. Safe to call repeatedly.
 start(){
  try{
   const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context)return Promise.resolve(false);
   this.ctx??=new Context();
   this._ensureBuses();
   // Keep the musical clock off the frame path: RAF can be throttled in a
   // hidden/heavy tab, and a later frame would otherwise replay missed steps.
   this.musicEngine?.setAutoTick?.(true);
   // The sampled announcer pack is opt-in with the announcer preference and
   // never blocks startup: the manifest fetch is fire-and-forget.
   if(this.announcer)this.loadAnnouncerPack();
   this.noiseBuffer??=this._makeNoise();
   if(this.ambientBed!==false)this._bed(true);
   this._precip(this.weather);
   return this.unlock();
  }catch{this.status='error';return Promise.resolve(false);}
 }
 // Resume a suspended AudioContext and record the outcome. Autoplay policies
 // require this to happen inside a user gesture; callers trigger it from clicks.
 unlock(){
  if(!this.ctx)return Promise.resolve(false);
  // Once the context is actually running, load the convolution reverb exactly
  // once per URL. A failed fetch/decode must NOT latch `reverbLoaded`: a later
  // unlock retries, so a transient or 404 failure stays recoverable instead of
  // silently disabling the IR for the session.
  const settle=(ok)=>{
   if(ok&&this.reverbUrl&&!this.reverbLoaded&&!this._reverbPending&&this.musicEngine&&!this.musicEngine.reverb){
    const url=this.reverbUrl;
    this._reverbPending=true;
    Promise.resolve(this.loadMusicReverb(url,{wet:this.reverbWet})).catch(()=>false).then(loaded=>{
     this._reverbPending=false;
     if(this.reverbUrl!==url)return;
     this.reverbLoaded=loaded===true;
    });
   }
   return ok;
  };
  if(this.ctx.state==='running'){this.status='running';return Promise.resolve(settle(true));}
  const res=this.ctx.resume?.();
  if(res&&typeof res.then==='function'){
   return res.then(()=>{this.status=this.ctx.state==='running'?'running':'suspended';return settle(this.status==='running');}).catch(()=>{this.status='blocked';return false;});
  }
  this.status=this.ctx.state||'suspended';return Promise.resolve(settle(this.status==='running'));
 }
 // Register a same-origin impulse response to attach on the next unlock. A new
 // URL cancels any in-flight attach for the old URL; the settle callback checks
 // the URL again before latching so a stale load cannot win.
 setReverbUrl(url,wet=0.30){this.reverbUrl=url||null;const w=Number(wet);this.reverbWet=Number.isFinite(w)?w:.30;this.reverbLoaded=false;this._reverbPending=false;if(this.ctx&&this.ctx.state==='running')this.unlock();return Boolean(url);}
 // Select a baked space IR by name (open-air/tunnel/hall/cathedral/cavern/void).
 // Resolved through the Moth registry; an unknown name falls back to `cavern`,
 // and a missing registry keeps whatever URL is already wired so a partial bake
 // never silences the reverb. Re-selecting the active space is a no-op, which
 // keeps per-arena swaps cheap and safe.
 setSpace(name,{wet=null}={}){
  const space=typeof name==='string'&&name?name:'cavern';
  if(this.reverbSpace===space)return this.reverbUrl;
  const ir=mothIr(space)||mothIr('cavern');
  if(!ir?.url)return this.reverbUrl;
  this.reverbSpace=space;
  const explicit=wet==null?NaN:Number(wet);
  const w=Number.isFinite(explicit)?explicit:(SPACE_WET[space]??0.42);
  this.setReverbUrl(ir.url,w);
  return this.reverbUrl;
 }
 // Apply a baked Moth echo/tap map to the shared effects send that gunfire,
 // explosions and thunder already route into. Keeps the existing node graph and
 // only re-tunes its delay/feedback/wet tail. Safe before the context exists:
 // the name is remembered and applied in `_ensureBuses`. The map has no
 // per-tap times in the v7.1 bake, so `depth` drives the feedback and the tap
 // count/levels drive wetness; a future map with `timeMs` seeds the delay.
 setEchoMap(name){
  const map=typeof name==='string'&&name?mothEchoMap(name):null;
  this.echoMap=map?name:null;
  try{this.mothAudio?.setSpace?.(this.echoMap);}catch{}
  this._applyEchoMap();
  return this.echoMap;
 }
 _applyEchoMap(){
  if(!this.space||!this.echoMap)return false;
  const map=mothEchoMap(this.echoMap);if(!map)return false;
  const taps=Array.isArray(map.taps)?map.taps:[];
  const first=taps.find(tap=>Number.isFinite(tap?.timeMs)&&tap.timeMs>0);
  const delay=first?cl(first.timeMs/1000,.04,.6):.16;
  const depth=Number.isFinite(Number(map.depth))?Number(map.depth):8;
  const levels=taps.map(tap=>Math.abs(Number(tap?.level))).filter(Number.isFinite);
  const mean=levels.length?levels.reduce((sum,v)=>sum+v,0)/levels.length:.5;
  const t=this.ctx?.currentTime||0;
  const set=(param,value)=>{try{if(param?.setTargetAtTime)param.setTargetAtTime(value,t,.05);else if(param)param.value=value;}catch{}};
  set(this.space.delay?.delayTime,delay);
  set(this.space.fb?.gain,cl(.25+depth*.02,.2,.6));
  set(this.space.wet?.gain,cl(.42+mean*.22,.35,.7));
  return true;
 }
 // Build the shared effects glue chain (compressor -> soft clip). Returns an
 // array of nodes whose first entry the effects bus connects into, or null when
 // the context cannot supply either stage. Bounded and deterministic: the
 // waveshaper curve is a fixed tanh table, never random.
 _makeEffectsGlue(){
  const ctx=this.ctx;if(!ctx)return null;
  const chain=[];
  try{
   if(typeof ctx.createDynamicsCompressor==='function'){
    const comp=ctx.createDynamicsCompressor();
    comp.threshold.value=-14;comp.knee.value=6;comp.ratio.value=4;comp.attack.value=.003;comp.release.value=.2;
    chain.push(comp);
   }
   if(typeof ctx.createWaveShaper==='function'&&typeof Float32Array==='function'){
    const shaper=ctx.createWaveShaper(),curve=new Float32Array(1024);
    for(let i=0;i<1024;i++){const x=(i/1023)*2-1;curve[i]=Math.tanh(x*1.7)/Math.tanh(1.7);}
    shaper.curve=curve;shaper.oversample='2x';
    chain.push(shaper);
   }
  }catch{return null;}
  if(!chain.length)return null;
  try{
   for(let i=0;i<chain.length-1;i++)chain[i].connect(chain[i+1]);
   chain[chain.length-1].connect(this.master);
  }catch{return null;}
  return chain;
 }
 _ensureBuses(){
  if(!this.ctx||this.master)return;
  const ctx=this.ctx;
  this.master=ctx.createGain();this.master.gain.value=this.volumes.master;
  this.muteGain=ctx.createGain();this.muteGain.gain.value=this.muted?0:1;
  // Optional master tone stage. A biquad is inserted between the master gain
  // and the mute gain only when the context can build one; the mix gain carries
  // the level half of the health/killcam/spectating profile. Any construction
  // failure falls back to the legacy direct link so a partial context can never
  // silence the mix.
  this.masterFilter=null;this.mixGain=null;
  try{
   this.mixGain=ctx.createGain();this.mixGain.gain.value=this._mixLevel??1;
   if(typeof ctx.createBiquadFilter==='function'){
    const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=this._mixCutoff??20000;f.Q.value=.5;
    this.master.connect(f);f.connect(this.mixGain);this.masterFilter=f;
   }else this.master.connect(this.mixGain);
   this.mixGain.connect(this.muteGain);
  }catch{
   try{this.master.connect(this.muteGain);}catch{}
   this.masterFilter=null;this.mixGain=null;
  }
  this.muteGain.connect(ctx.destination);
  this.effectsBus=ctx.createGain();this.effectsBus.gain.value=this.volumes.effects;
  // Shared effects glue: a compressor plus a soft-clip ceiling inserted between
  // the effects bus and the master, so layered explosions and chaingun volleys
  // cannot clip the destination. The ambience and music buses stay direct
  // (music already owns its limiter); when a context lacks the nodes the bus
  // connects straight to the master exactly as before.
  this.effectsGlue=this._makeEffectsGlue();
  if(this.effectsGlue)this.effectsBus.connect(this.effectsGlue[0]);else this.effectsBus.connect(this.master);
  this.ambienceBus=ctx.createGain();this.ambienceBus.gain.value=this.volumes.ambience;this.ambienceBus.connect(this.master);
  // The soundtrack's own gain stage, so the in-game music slider is real: the
  // engine sums into musicBus, which then feeds the master.
  this.musicBus=ctx.createGain();this.musicBus.gain.value=this.volumes.music;this.musicBus.connect(this.master);
  // Shared "space" send: a fixed delay + damped feedback loop. Weapon tails,
  // explosions and thunder route part of their output here so distant fights
  // keep depth without a convolution IR or per-sound scheduling. Optional:
  // contexts without DelayNode (and every Node test fixture) skip it.
  this.space=null;
  if(typeof ctx.createDelay==='function'&&typeof ctx.createBiquadFilter==='function'){
   try{
    const send=ctx.createGain(),delay=ctx.createDelay(.6),damp=ctx.createBiquadFilter(),fb=ctx.createGain(),wet=ctx.createGain();
    delay.delayTime.value=.16;damp.type='lowpass';damp.frequency.value=2000;fb.gain.value=.34;wet.gain.value=.55;send.gain.value=1;
    send.connect(delay);delay.connect(damp);damp.connect(fb);fb.connect(delay);delay.connect(wet);wet.connect(this.effectsBus||this.master);
    this.space={send,delay,damp,fb,wet};
   }catch{this.space=null;}
  }
  this._applyEchoMap();
  try{this.musicEngine=new MusicEngine({ctx,destination:this.musicBus,theme:this.theme,noiseBuffer:this.noiseBuffer,seed:(Date.now()&0xffff)||1});}
  catch{this.musicEngine=null;}
  if(this.musicEngine){this.musicEngine.setEnabled(this.musicEnabled);this.musicEngine.setMuted(this.muted);this.musicEngine.setScene(this.scene);this.musicEngine.setSoundtrack(this.soundtrack||'default');this.musicEngine.setPalette?.(this.mode);this.musicEngine.setBiomePalette?.(this.bedMood);this.musicEngine.setTension?.(this.tension);this.musicEngine.setEscalation?.(this.escalation);if(this.variationKey!=null)this.musicEngine.setVariation?.(this.variationKey);}
  // The context and buses now exist, so a deferred Moth layer can be built and
  // attached. Idempotent: the factory is consumed on first success.
  this._ensureMothAudio();
  this.status=ctx.state||'suspended';
 }
 // Immediate master mute. The mute gain is set synchronously (not ramped) so a
 // mute silences a running music pad instantly; music scheduling pauses so no
 // new notes are queued while silent.
 setMuted(on){
  this.muted=on===true;
  if(!this.ctx)return this.muted;
  this._ensureBuses();
  try{this.muteGain.gain.cancelScheduledValues?.(this.ctx.currentTime);}catch{}
  try{this.muteGain.gain.value=this.muted?0:1;}catch{}
  this.musicEngine?.setMuted(this.muted);
  if(this.muted){this._engine(0,false);this._bed(false);}
  else if(this.ambientBed!==false)this._bed(true);
  this._precip(this.weather);
  if(!this.muted)this.unlock();
  return this.muted;
 }
 setVolume(kind,value){
  const key=kind in this.volumes?kind:null;if(!key)return null;
  const v=Math.max(0,Math.min(1.5,Number(value)));
  this.volumes[key]=Number.isFinite(v)?v:this.volumes[key];
  if(key==='master'&&this.master)try{this.master.gain.value=this.volumes.master;}catch{}
  if(key==='music'&&this.musicBus)try{this.musicBus.gain.value=this.volumes.music;}catch{}
  if(key==='effects'&&this.effectsBus)try{this.effectsBus.gain.value=this.volumes.effects;}catch{}
  if(key==='ambience'&&this.ambienceBus)try{this.ambienceBus.gain.value=this.volumes.ambience;}catch{}
  return this.volumes[key];
 }
 getVolume(kind){return this.volumes[kind]??null;}
 // ---- Dynamic mix -----------------------------------------------------------
 //
 // Master tone stage and ducking. Defaults are neutral: the biquad sits wide
 // open at 20 kHz and the mix gain at unity, so every existing graph and voice
 // sounds exactly as before until health/killcam/spectating move it. All easing
 // is setTargetAtTime (with a direct value fallback) on long-lived nodes.
 _applyMix(cutoff,level,smoothing=.3){
  const c=cl(Number(cutoff)||0,300,20000),l=cl(Number(level)||0,0,1.2);
  if(Math.abs(c-(this._mixCutoff??20000))<1&&Math.abs(l-(this._mixLevel??1))<.005)return false;
  this._mixCutoff=c;this._mixLevel=l;
  if(!this.ctx)return true;
  const t=Number.isFinite(this.ctx.currentTime)?this.ctx.currentTime:0;
  try{const f=this.masterFilter?.frequency;if(f){if(f.setTargetAtTime)f.setTargetAtTime(c,t,smoothing);else f.value=c;}}catch{}
  try{const g=this.mixGain?.gain;if(g){if(g.setTargetAtTime)g.setTargetAtTime(l,t,smoothing);else g.value=l;}}catch{}
  return true;
 }
 // Resolve the cutoff/level target from the active state machine. Killcam wins,
 // then spectating, then the health-derived profile (full health is neutral).
 _mixTargets(){
  if(this.killcam)return {cutoff:650,level:.7};
  if(this.spectating)return {cutoff:6000,level:.86};
  const f=Number.isFinite(this.healthMix)?this.healthMix:1;
  return {cutoff:cl(20000*(.32+.68*f),2400,20000),level:cl(.84+.16*f,.84,1)};
 }
 // Health-driven ease. A missing/non-finite health pair is treated as full
 // health, so fixtures and menu updates keep the mix neutral.
 _applyHealthMix(fraction){
  this.healthMix=Number.isFinite(fraction)?cl(fraction,0,1):1;
  const {cutoff,level}=this._mixTargets();
  return this._applyMix(cutoff,level,.6);
 }
 // Bounded soundtrack duck: amount 0..1, duration 60..4000 ms. Reuses the
 // sting's timer pattern, and a new duck always replaces the pending release so
 // overlapping calls cannot strand the soundtrack quiet.
 _duckMusic(amount=.4,ms=600){
  const level=cl(Number(amount)||0,0,1),duration=cl(Number(ms)||600,60,4000);
  this._musicDuck=level;
  this.musicEngine?.setDuck?.(level);
  if(this._musicDuckTimer)clearTimeout(this._musicDuckTimer);
  this._musicDuckTimer=setTimeout(()=>{
   this._musicDuckTimer=null;this._musicDuck=0;
   try{this.musicEngine?.setDuck?.(0);}catch{}
  },duration);
  if(this._musicDuckTimer&&typeof this._musicDuckTimer.unref==='function')this._musicDuckTimer.unref();
  return level;
 }
 // One-voice sub drop for the killcam take: a short 120->34 Hz sine with a
 // muffled low transient. Inherits the voice cap, mute gate and disposal.
 _subDrop(){
  if(!this.ctx||this.muted)return false;
  this._play(.34,0,(t,out,nodes)=>{
   this._tone(t,out,nodes,{freq:120,duration:.3,type:'sine',gain:.16,end:34});
   this._noise(t,out,nodes,{duration:.05,attack:.001,gain:.1,type:'lowpass',freq:420,sweep:120,q:.8});
  },{send:.2});
  return true;
 }
 // Killcam mix: duck the soundtrack, low-pass the master and drop a short sub
 // under the camera takeover. Idempotent: a repeated state makes no new voice.
 setKillcam(on){
  const next=on===true;
  if(next===this.killcam)return this.killcam;
  this.killcam=next;
  if(next){
   this._duckMusic(.6,1400);
   this._applyMix(650,.7,.18);
   this._subDrop();
  }else{
   const {cutoff,level}=this._mixTargets();
   this._applyMix(cutoff,level,.5);
  }
  return this.killcam;
 }
 // Spectator gain profile: a slightly darker, slightly quieter mix while
 // watching another actor. Idempotent and superseded by an active killcam.
 setSpectating(on){
  const next=on===true;
  if(next===this.spectating)return this.spectating;
  this.spectating=next;
  const {cutoff,level}=this._mixTargets();
  this._applyMix(cutoff,level,.8);
  return this.spectating;
 }
 // Scene drives the soundtrack arrangement: menus get the menu theme, matches
 // get exploration/combat layered by intensity. Returning to the menu releases
 // a victory/defeat outcome (and its baked motif) so the menu motif is restored
 // instead of being replaced for the session; a fresh match does the same when
 // it starts. Returning to the menu also ends any live-match dedupe so the next
 // FIGHT sting can fire.
 setScene(scene){const key=scene==='menu'?'menu':scene==='results'?'results':'game';this.scene=key;if(key==='menu'){this.matchEnd();if(this.musicEngine?.outcome)this.setOutcome(null);}this.musicEngine?.setScene(key==='menu'?'menu':key==='results'?'results':(this.intensity>=.34?'combat':'explore'));this.mothAudio?.setScene?.(key);return this.scene;}
 // Victory/defeat selects the results arrangement (Picardy tonic on a win).
 // Victory/defeat also hands the baked Moth outcome motif to the soundtrack's
 // lead voice. Motifs are note data (not decodable clips), so this is the
 // `MusicEngine.setMotif` route rather than `MothAudio.playStinger`; the results
 // arrangement opts in with `leadMotif` and falls back to the built-in COCS
 // line when no motif is loaded. An unknown outcome clears the motif.
 setOutcome(outcome){
  const key=outcome==='victory'||outcome==='defeat'?outcome:null;
  // Remember the motif that was playing before the outcome took over so
  // clearing the outcome restores the menu motif instead of only dropping it.
  if(key&&!this.musicEngine?.outcome)this._motifBeforeOutcome=this.musicEngine?.motif??null;
  const motif=key?mothMotif(`moth-${key}`):null;
  if(motif)this.setMotif(motif);
  else if(!key){const restore=this._motifBeforeOutcome??null;this._motifBeforeOutcome=null;this.setMotif(restore);}
  return this.musicEngine?.setOutcome?.(outcome)??null;
 }
 // ---- Match start / countdowns ---------------------------------------------
 //
 // Every transition machine here is edge-detected from state the host already
 // owns (the event stream, the live match snapshot, the race/soccer phase) and
 // held in bounded fields, so a reconnect, a replay or a repeated frame can
 // never double-fire a sting or a beep. No page timers are involved.
 //
 // `key` lets a host pin the sting to a match identity; without one the live
 // flag alone dedupes. `restart` forces a fresh match (host rematch).
 matchStart(opts={}){
  const key=opts&&typeof opts==='object'&&opts.key!=null?String(opts.key):null;
  const restart=opts&&typeof opts==='object'&&opts.restart===true;
  if(!restart&&this._matchLive)return {played:false,deduped:true};
  if(!restart&&key!==null&&key===this._matchKey)return {played:false,deduped:true};
  // A new match releases any stale victory/defeat outcome so the fresh round
  // starts from the mode motif instead of the previous round's take.
  if(this.musicEngine?.outcome)this.setOutcome(null);
  this._matchLive=true;this._matchKey=key;this._finalWarned=false;this._countdown={phase:null,beat:0};
  // A fresh match starts from rest: release any danger/escalation state and the
  // per-event music dedupe so a rematch can voice its hooks again.
  this.setTension(0);this.setEscalation(0);this._musicBeats.clear();
  this._fightSting();
  return {played:true,key};
 }
 // End the live match so the next start can voice its FIGHT sting. Called by the
 // outcome sting and whenever the host returns to the menu. The soundtrack's
 // danger/escalation state is released with it.
 matchEnd(){
  const wasLive=this._matchLive;
  this._matchLive=false;this._matchKey=null;
  this.setTension(0);this.setEscalation(0);
  // Drop a queued response that no longer belongs to a live match.
  try{this.musicEngine?.clearResponses?.();}catch{}
  return wasLive;
 }
 // FIGHT sting: a three-note fanfare over a short low impact body. One voice.
 _fightSting(){
  if(!this.ctx||this.muted)return false;
  const root=this.theme?.root??58,freq=step=>root*Math.pow(2,Number(step)/12);
  this._play(.62,0,(t,out,nodes)=>{
   FIGHT_CUE.notes.forEach((step,i)=>this._tone(t+i*FIGHT_CUE.step,out,nodes,{freq:freq(step)*2,duration:FIGHT_CUE.length,type:'square',gain:FIGHT_CUE.gain,end:freq(step)*2*1.06}));
   this._noise(t,out,nodes,{duration:.3,gain:.18,type:'lowpass',freq:560,sweep:120,q:.8,attack:.004});
   this._tone(t,out,nodes,{freq:freq(0),duration:.4,type:'sine',gain:.1,end:freq(0)*.52});
  },{send:.16});
  return true;
 }
 // Race/soccer 3-2-1-GO edge detector. Accepts the existing race or soccer
 // state object (`{phase,countdown}`) and beeps once per countdown number and
 // once on the countdown -> racing/playing flip. A host that first reports a
 // running race (a mid-race join) gets no false GO.
 countdown(state){
  const phase=String(state?.phase??''),value=Number(state?.countdown);
  const active=phase==='countdown'||phase==='kickoff';
  const running=phase==='racing'||phase==='playing';
  const previous=this._countdown||{phase:null,beat:0};
  const beat=active&&Number.isFinite(value)?Math.max(1,Math.ceil(value)):0;
  this._countdown={phase,beat};
  if(running&&(previous.phase==='countdown'||previous.phase==='kickoff')){
   // The GO releases the countdown tension; the beep already owns the beat.
   this.setTension(0);
   this._countdownBeep(0,true);
   return {played:true,go:true,beat:0};
  }
  if(active&&(beat!==previous.beat||phase!==previous.phase)&&beat>=1&&beat<=3){
   // Each countdown number tightens the danger layer a step further (state only,
   // never a second voice on top of the beep).
   this.setTension(cl(.2+(3-beat)*.25,0,1));
   this._countdownBeep(beat,false);
   return {played:true,go:false,beat};
  }
  return {played:false,go:false,beat};
 }
 setRaceState(state){return this.countdown(state);}
 setSoccerState(state){return this.countdown(state);}
 // 3-2-1-GO voice. One short beep token per number; GO is brighter and longer.
 _countdownBeep(beat,go){
  if(!this.ctx||this.muted)return false;
  const freq=go?988:659;
  this._play(go?.3:.16,0,(t,out,nodes)=>{
   this._tone(t,out,nodes,{freq,duration:go?.22:.11,type:'square',gain:go?.1:.075,end:go?freq*1.5:freq});
   if(go)this._tone(t,out,nodes,{freq:freq*.5,duration:.26,type:'sine',gain:.06,end:freq*.52});
  });
  return true;
 }
 // Final-ten-seconds warning: fires once when the remaining clock first crosses
 // the ten-second mark, then stays silent until the next match start.
 finalSecondsWarning(secondsLeft){
  const s=Number(secondsLeft);
  if(!Number.isFinite(s))return {warned:false};
  if(s>10||s<=0||this._finalWarned)return {warned:false,deduped:Boolean(this._finalWarned)};
  this._finalWarned=true;
  // The soundtrack owns the final call when it is running: a tension pulse plus
  // a low response on the next music step, with no motif stacked on top. With
  // music off the historical FINAL_CUE keeps the beat.
  this.setTension(1);
  const owned=this._musicResponse('final',{vol:1});
  if(!owned)this._beat(FINAL_CUE,0,1,.26);
  return {warned:true,music:owned};
 }
 // One entry point for the live match snapshot: mode theme, FIGHT sting,
 // race/soccer countdown and the final warning. Callable every frame; every
 // transition is edge-detected above.
 setMatchState(state){
  if(!state||typeof state!=='object')return {started:false,countdown:null,final:null};
  const mode=state.config?.mode??state.mode??null;
  if(mode&&mode!==this.mode)this.setModeTheme(mode);
  if(state.over===true){this.matchEnd();return {started:false,countdown:null,final:null};}
  const started=this.matchStart().played===true;
  const countdown=state.race?this.countdown(state.race):null;
  const limit=Number(state.config?.timeLimit);
  const final=Number.isFinite(limit)&&limit>0?this.finalSecondsWarning(limit-Number(state.time)):null;
  return {started,countdown,final};
 }
 previewMusic(scene='menu',seconds=8){this._ensureBuses();const r=this.musicEngine?.preview(scene,seconds);this.unlock();return r??null;}
 // Select an arrangement pack (e.g. 'halo'); delegates to the music engine.
 setSoundtrack(name='default'){this.soundtrack=(name==='halo')?'halo':'default';this._ensureBuses();this.theme=this.soundtrack==='halo'?HALO_THEME:(MODE_THEMES[this.mode]||MODE_THEMES.default);return this.musicEngine?.setSoundtrack(this.soundtrack)??this.soundtrack;}
 // Hand a baked motif (e.g. from qrc-midi) to the soundtrack's lead voice.
 setMotif(motif){return this.musicEngine?.setMotif(motif)??0;}
 // Attach a convolution impulse response (an AudioBuffer) to the music reverb.
 setMusicReverb(buffer,opts){return this.musicEngine?.setReverb(buffer,opts)??false;}
 // Fetch and decode a same-origin impulse response WAV, then attach it. Safe to
 // call repeatedly and safe when the context is not yet running.
 async loadMusicReverb(url,opts){
  if(!url)return false;
  try{
   this._ensureBuses();
   if(!this.ctx||typeof this.ctx.decodeAudioData!=='function')return false;
   const response=await fetch(url,{cache:'force-cache'});
   if(!response.ok)return false;
   const bytes=await response.arrayBuffer();
   const buffer=await new Promise((resolve,reject)=>{const p=this.ctx.decodeAudioData(bytes,resolve,reject);if(p&&typeof p.then==='function')p.then(resolve,reject);});
   if(!this.musicEngine)return false;
   return this.musicEngine.setReverb(buffer,opts);
  }catch{return false;}
 }
 audioStatus(){return {state:this.ctx?(this.ctx.state||'suspended'):'unavailable',status:this.status,enabled:this.musicEnabled,muted:this.muted,scene:this.scene,intensity:this.intensity,tension:this.tension,escalation:this.escalation,variation:this.musicEngine?.variation??0,palette:this.musicEngine?.paletteName??'default',kit:this.musicEngine?.kitName??'default',voices:this.voices.size,notes:this.musicEngine?.notesScheduled??0,music:this.musicEngine?.status?.()??'off',musicVoices:this.musicEngine?.voices?.length??0,sustainVoices:this.musicEngine?.sustainVoices??0,sustainBudget:this.musicEngine?.sustainBudget??0,peakVoices:this.musicEngine?.peakVoices??0,layers:this.musicEngine?.layers?{...this.musicEngine.layers}:null,transitions:this.musicEngine?.transitions??0,pendingResponses:this.musicEngine?.pendingResponses?.length??0,reverb:this.reverbLoaded?'ready':(this._reverbPending?'loading':(this.reverbUrl?'pending':'off')),space:this.reverbSpace,echo:this.echoMap,weather:this.weather,biome:this.biomeMood,glue:this.effectsGlue?'on':'off',filter:this.masterFilter?'on':'off',duck:this._musicDuck??0,cutoff:this._mixCutoff??20000,mixLevel:this._mixLevel??1,killcam:this.killcam===true,spectating:this.spectating===true,announcerVoice:{loaded:Boolean(this.announcerPack),ready:this.announcerPack?.buffers?.size??0,pending:this.announcerPack?.pending?.size??0,failed:this.announcerPack?.failed?.size??0},moth:this.mothAudio?.status?.()??null,samples:this.musicEngine?.sampleStatus?.()??null};}
 // Low, continuous ambience bed: filtered noise hiss plus a sub tone, faded in
 // through the master gain. Owned by the audio instance and torn down in dispose.
 _bed(on){
  if(!this.ctx||!this.master)return;
  if(on&&!this.bed&&!this.muted){
   if(!this.noiseBuffer)this.noiseBuffer=this._makeNoise();
   const profile=BED_MOODS[this.bedMood]||BED_MOODS.default,t=this.ctx.currentTime,src=this.ctx.createBufferSource();src.buffer=this.noiseBuffer;src.loop=true;
   const f=this.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=profile.filter;f.Q.value=.5;
   const g=this.ctx.createGain();g.gain.value=.0001;
   const osc=this.ctx.createOscillator();osc.type='sine';osc.frequency.value=profile.tone;
   const og=this.ctx.createGain();og.gain.value=.0001;
   src.connect(f);f.connect(g);g.connect(this.ambienceBus||this.master);osc.connect(og);og.connect(this.ambienceBus||this.master);
   // Wind bed (bandpassed noise plus a slow gust LFO) and tension drone
   // (triangle whose gain follows combat intensity). Both are continuous and
   // bounded: two sources, one LFO and three gains, torn down with the bed.
   const wind=this._windLayer(profile),tense=this._tensionLayer(profile);
   if(wind)wind.windG.gain.setTargetAtTime((profile.air||0)*this._windScale(profile),t,1);
   if(tense)tense.tenseG.gain.setTargetAtTime((profile.tense||0)*this.intensity*this.intensity,t,1);
   src.start();osc.start();g.gain.setTargetAtTime(profile.gain,t,.8);og.gain.setTargetAtTime(profile.sub,t,.9);
   this.bed=Object.assign({src,f,g,osc,og},wind||{},tense||{});
  }else if(!on&&this.bed){
   for(const node of Object.values(this.bed)){if(node&&typeof node.stop==='function')try{node.stop();}catch{}if(node&&typeof node.disconnect==='function')try{node.disconnect();}catch{}}
   this.bed=null;
  }
 }
 _windLayer(profile){
  if(typeof this.ctx.createBufferSource!=='function')return null;
  const src=this.ctx.createBufferSource();src.buffer=this.noiseBuffer;src.loop=true;
  const f=this.ctx.createBiquadFilter();f.type='bandpass';f.frequency.value=profile?.windFreq||520;f.Q.value=.45;
  const g=this.ctx.createGain();g.gain.value=.0001;
  src.connect(f);f.connect(g);g.connect(this.ambienceBus||this.master);
  let lfo=null,lfoGain=null;
  if(typeof this.ctx.createOscillator==='function'){
   lfo=this.ctx.createOscillator();lfo.type='sine';lfo.frequency.value=.07;
   lfoGain=this.ctx.createGain();lfoGain.gain.value=(profile?.air||0)*.5;
   lfo.connect(lfoGain);lfoGain.connect(g.gain);lfo.start();
  }
  src.start();
  return {windSrc:src,windF:f,windG:g,windLfo:lfo,windLfoGain:lfoGain};
 }
 _tensionLayer(profile){
  if(typeof this.ctx.createOscillator!=='function')return null;
  const osc=this.ctx.createOscillator();osc.type='triangle';osc.frequency.value=profile?.tenseFreq||58;
  const g=this.ctx.createGain();g.gain.value=.0001;
  osc.connect(g);g.connect(this.ambienceBus||this.master);osc.start();
  return {tenseOsc:osc,tenseG:g};
 }
 _windScale(profile){return Number.isFinite(this.windScale)?cl(this.windScale,0,3):cl(Number(profile?.wind)||1,0,3);}
 // Optional wind override (0..3). Derived from the bed mood when never set;
 // eases the running wind layer without restarting nodes.
 setWind(strength){
  const value=Number(strength);
  this.windScale=Number.isFinite(value)?cl(value,0,3):null;
  if(!this.bed||!this.ctx)return this.windScale;
  const profile=BED_MOODS[this.bedMood]||BED_MOODS.default;
  if(this.bed.windG)try{this.bed.windG.gain.setTargetAtTime((profile.air||0)*this._windScale(profile)*(.5+this.bedScale*.5),this.ctx.currentTime,1.2);}catch{}
  return this.windScale;
 }
 // Optional surface resolver for movement foley. `fn(x,z,player)` returns an
 // authored material string (or null); called only for the local player's
 // footsteps, landings, jumps and slides, so it can safely hit the terrain.
 setSurfaceResolver(fn){this.surfaceResolver=typeof fn==='function'?fn:null;return this.surfaceResolver;}
 _surfaceFor(player,opts){
  if(opts&&typeof opts.surface==='string')return opts.surface;
  if(player&&typeof player.surface==='string')return player.surface;
  if(opts&&typeof opts.surfaceAt==='function'&&player){try{const s=opts.surfaceAt(player.x||0,player.z||0);if(s)return s;}catch{}}
  if(this.surfaceResolver&&player){try{const s=this.surfaceResolver(player.x||0,player.z||0,player);if(s)return s;}catch{}}
  return null;
 }
 setAmbient(on){this.ambientBed=on!==false;if(!this.ctx)return;this._bed(this.ambientBed&&!this.muted);this._precip(this.weather);}
 // Ease the running ambience bed toward a biome mood without restarting nodes.
 // When the bed is not running yet the mood is remembered for the next start.
 // A `default` request under clear skies is upgraded to the arena's biome mood,
 // so the biome ambience the view already computes is actually heard; an
 // explicit weather mood always wins over the fallback.
 setBedMood(mood){
  let key=BED_MOODS[mood]?mood:'default';
  const noWeatherOverride=this.weather==null||this.weather==='clear';
  if(key==='default'&&noWeatherOverride&&this.biomeMood&&this.biomeMood!=='default'&&BED_MOODS[this.biomeMood])key=this.biomeMood;
  this.bedMood=key;
  this.mothAudio?.setBedMood?.(this.bedMood);
  // The resolved bed mood doubles as the biome palette selection (unknown moods
  // fall back to the all-off default inside the engine).
  this.musicEngine?.setBiomePalette?.(key);
  // Without an explicit weather override, the weather-driven bed mood doubles as
  // the precipitation signal the host already sends: a storm mood means rain or
  // storm, so the synth presence and the Moth weather bed follow it. Ash and
  // snow remain explicit (`setWeather('ash'|'snow')`) because their moods
  // overlap biomes.
  if(this.weather==null){
   const inferred=key==='storm'?'rain':null;
   this._precip(inferred);
   this.mothAudio?.setWeather?.(inferred);
  }
  if(!this.bed||!this.ctx)return this.bedMood;
  const profile=BED_MOODS[this.bedMood],t=this.ctx.currentTime;
  try{this.bed.f.frequency.setTargetAtTime(profile.filter,t,1.2);this.bed.osc.frequency.setTargetAtTime(profile.tone,t,1.2);this.bed.g.gain.setTargetAtTime(profile.gain,t,1.2);this.bed.og.gain.setTargetAtTime(profile.sub,t,1.2);}catch{}
  try{
   if(this.bed.windF)this.bed.windF.frequency.setTargetAtTime(profile.windFreq||520,t,1.4);
   if(this.bed.windG)this.bed.windG.gain.setTargetAtTime((profile.air||0)*this._windScale(profile)*(.5+this.bedScale*.5),t,1.4);
   if(this.bed.tenseOsc)this.bed.tenseOsc.frequency.setTargetAtTime(profile.tenseFreq||58,t,1.4);
   if(this.bed.tenseG)this.bed.tenseG.gain.setTargetAtTime((profile.tense||0)*this.intensity*this.intensity,t,1.2);
  }catch{}
  return this.bedMood;
 }
 // Remember the arena's biome mood (from `biomeAmbience(arena).mood`). It is the
 // bed fallback whenever no weather override supplies a mood of its own.
 setBiomeMood(mood){
  this.biomeMood=BED_MOODS[mood]?mood:'default';
  if(this.weather==null||this.weather==='clear')this.setBedMood(this.biomeMood);
  else this.musicEngine?.setBiomePalette?.(this.biomeMood);
  return this.biomeMood;
 }
 // Convenience for a host holding the arena (or just its id): compute the mood
 // through the shared environment table and remember it.
 setArenaBiome(arena){
  const ambience=biomeAmbience(typeof arena==='string'?{id:arena}:(arena||{}));
  return this.setBiomeMood(ambience.mood);
 }
 // Weather override routing. `kind` is one of WEATHER_KINDS or null for clear.
 // The raw kind is forwarded to the Moth layer, drives the precipitation noise
 // presence and selects the bed mood (clear falls back to the biome mood).
 setWeather(kind){
  const preset=kind==null?null:weatherPreset(kind);
  const next=preset?preset.kind:null;
  this.weather=next;
  this.mothAudio?.setWeather?.(next);
  this._precip(next);
  const mood=preset?.audio;
  if(mood&&BED_MOODS[mood]&&mood!=='default')this.setBedMood(mood);
  else this.setBedMood(this.biomeMood);
  return next;
 }
 // Precipitation noise presence: one looped noise source on the ambience bus
 // per active kind (rain/storm hiss, ash hush, snow air), eased in and out with
 // the weather. Bounded to a single source and never allocated when muted.
 _precip(kind){
  if(!this.ctx||!this.ambienceBus)return false;
  const profile=PRECIP_BEDS[kind];
  const want=Boolean(profile)&&!this.muted&&this.ambientBed!==false;
  if(!want){
   if(this.precip){const precip=this.precip;this.precip=null;for(const node of Object.values(precip)){if(node&&typeof node.stop==='function')try{node.stop();}catch{}if(node&&typeof node.disconnect==='function')try{node.disconnect();}catch{}}}
   return false;
  }
  if(this.precip&&this.precip.kind!==kind){
   const old=this.precip;this.precip=null;
   for(const node of Object.values(old)){if(node&&typeof node.stop==='function')try{node.stop();}catch{}if(node&&typeof node.disconnect==='function')try{node.disconnect();}catch{}}
  }
  if(!this.precip){
   if(!this.noiseBuffer)this.noiseBuffer=this._makeNoise();
   try{
    const src=this.ctx.createBufferSource();src.buffer=this.noiseBuffer;src.loop=true;
    const f=this.ctx.createBiquadFilter();f.type=profile.type;f.frequency.value=profile.freq;f.Q.value=profile.q;
    const g=this.ctx.createGain();g.gain.value=.0001;
    src.connect(f);f.connect(g);g.connect(this.ambienceBus);
    src.start();
    this.precip={kind,src,f,g};
   }catch{this.precip=null;return false;}
  }
  const t=this.ctx.currentTime||0;
  try{this.precip.g.gain.setTargetAtTime(profile.gain,Math.max(0,t),1.4);}catch{}
  return true;
 }
 // Combat intensity drives the soundtrack arrangement (exploration vs combat
 // layering) and lets the ambience bed duck so gunfire cuts through. It never
 // starts or stops the soundtrack: music plays continuously once enabled.
 setIntensity(value){
  const next=cl(Number(value)||0,0,1);this.intensity=next;
  this.musicEngine?.setIntensity(next);
  // Results must hold the outcome arrangement; only the live scene resolves
  // between exploration and combat from intensity.
  this.musicEngine?.setScene(this.scene==='menu'?'menu':this.scene==='results'?'results':(next>=.34?'combat':'explore'));
  this.mothAudio?.setIntensity?.(next);
  this.bedScale=.55+next*.55;
  if(this.ctx&&this.bed){const profile=BED_MOODS[this.bedMood]||BED_MOODS.default,t=this.ctx.currentTime;try{this.bed.g.gain.setTargetAtTime(profile.gain*this.bedScale,t,.5);this.bed.og.gain.setTargetAtTime(profile.sub*this.bedScale,t,.55);}catch{}try{if(this.bed.windG)this.bed.windG.gain.setTargetAtTime((profile.air||0)*this._windScale(profile)*(.5+this.bedScale*.5),t,.6);if(this.bed.tenseG)this.bed.tenseG.gain.setTargetAtTime((profile.tense||0)*next*next,t,.7);}catch{}}
  return this.intensity;
 }
 // Dynamic music state (forwarded to the soundtrack and applied only by the
 // engine's scheduler). Tension 0..1 adds the low-string tremolo danger layer;
 // escalation 0..3 selects the short-form/faster mode. Both are pure setters:
 // no voice is spent and the transport is never restarted.
 setTension(value){
  const next=cl(Number(value)||0,0,1);this.tension=next;
  this.musicEngine?.setTension?.(next);
  this.mothAudio?.setTension?.(next);
  return next;
 }
 setEscalation(value){
  const n=Number(value);const next=cl(Number.isFinite(n)?Math.round(n):0,0,3);this.escalation=next;
  this.musicEngine?.setEscalation?.(next);
  this.mothAudio?.setEscalation?.(next);
  return next;
 }
 // Seeded performance variation: a string key or a positive integer id selects
 // the per-bar ornaments; 0/null restores the untouched baseline take. Returns
 // the resolved variation id (0 when off).
 setVariation(key){
  this.variationKey=key==null?null:key;
  return this.musicEngine?.setVariation?.(key)??0;
 }
 // True when the soundtrack can answer a beat right now (built, enabled and
 // unmuted). The single-owner rule routes a beat to the music only when this is
 // true; otherwise the caller keeps its motif or announcer voice.
 _musicAvailable(){return Boolean(this.ctx&&this.musicEngine&&this.musicEnabled!==false&&!this.muted&&this.musicEngine.enabled!==false&&this.musicEngine.muted!==true);}
 _musicResponse(kind,opts=null){return this._musicAvailable()&&this.musicEngine.requestResponse?.(kind,opts||undefined)===true;}
 // Per-event-id dedupe for the music hooks, so a replayed or repeated event can
 // never fire an accent/escalation twice. An event without an id is not deduped
 // (the live stream always carries one); the map is bounded to 128 keys.
 _claimMusicBeat(id,tag){
  if(id==null)return true;
  const key=`${tag}:${id}`;
  if(this._musicBeats.has(key))return false;
  if(this._musicBeats.size>=128)this._musicBeats.delete(this._musicBeats.keys().next().value);
  this._musicBeats.add(key);
  return true;
 }
 // Select the tonal centre for a game mode. Every soundtrack layer reads the
 // shared theme, so switching modes retunes the music without restarting nodes.
 setModeTheme(mode){
  const key=typeof mode==='string'&&MODE_THEMES[mode]?mode:'default';
  this.mode=key;
  // The Halo soundtrack owns a single modal tonal centre; mode themes still
  // apply to the baseline soundtrack and to outcome stings.
  this.theme=(this.soundtrack==='halo')?HALO_THEME:MODE_THEMES[key];
  if(this.soundtrack==='halo')this.musicEngine?.setSoundtrack('halo');else this.musicEngine?.setTheme(this.theme);
  // Mode palettes only toggle optional authored colour; they never touch the
  // theme, so the Halo pack keeps its single modal centre.
  this.musicEngine?.setPalette?.(key);
  return key;
 }
 // Advance the soundtrack scheduler. Called once per rendered frame from the
 // host so note timing is driven by the AudioContext clock, not the frame rate.
 tick(){const scheduled=this.musicEngine?.tick?.()??0;this.mothAudio?.tick?.();return scheduled;}
 // Victory/defeat sting: a short arpeggio built from the active mode scale. It
 // reuses the shared voice cap and disposal path, and is a no-op when muted or
 // when the context has not started.
 sting(outcome){
  const cue=STING_CUES[outcome];if(!cue)return null;
  if(!this.ctx||this.muted)return {outcome,played:false};
  const scale=this.theme?.scale||MODE_THEMES.default.scale,root=this.theme?.root??58;
  const freq=step=>root*Math.pow(2,(scale[step%scale.length]+12*(cue.octave-1))/12);
  this._play(cue.length+(cue.notes.length-1)*cue.step+.3,0,(t,out,nodes)=>{
   cue.notes.forEach((step,i)=>{const f=freq(step);this._tone(t+i*cue.step,out,nodes,{freq:f,duration:cue.length,type:cue.type,gain:cue.gain,end:f*cue.end});});
   // Low body drone plus a brief upper shimmer so the resolution reads even
   // when a firefight overlaps the last note. Still one voice token.
   this._tone(t,out,nodes,{freq:root*.5,duration:.5,type:'sine',gain:outcome==='victory'?.05:.04,end:root*.52});
   this._noise(t+.02,out,nodes,{duration:.32,gain:outcome==='victory'?.07:.055,type:'highpass',freq:2800,sweep:1200,q:.6,attack:.02});
  },{send:.28});
  this.lastSting=outcome;
  // Duck the soundtrack under the sting so the result reads clearly, then ease
  // it back. The timer is cleared on disposal so it cannot outlive the engine.
  // The soundtrack also moves to the results scene, where the baked victory or
  // defeat motif (or the arrangement's major fallback) is voiced.
  this.setOutcome(outcome);
  // The outcome ends the live match: release the start dedupe so a rematch can
  // voice its FIGHT sting, and clear the final-ten-second latch.
  this.matchEnd();this._finalWarned=false;
  this.musicEngine?.setDuck(1);
  if(this._stingDuckTimer)clearTimeout(this._stingDuckTimer);
  this._stingDuckTimer=setTimeout(()=>{this._stingDuckTimer=null;this.musicEngine?.setDuck(0);},1400);
  return {outcome,played:true};
 }
 setAnnouncer(on){this.announcer=on===true;if(this.announcer&&this.ctx)this.loadAnnouncerPack();return this.announcer;}
 // Music on/off is independent of the global mute: disabling it silences and
 // pauses only the soundtrack, while effects, ambience and the announcer keep
 // playing. Re-enabling attempts an autoplay unlock and resumes scheduling.
 setMusicEnabled(on){
  this.musicEnabled=on!==false;
  this.musicEngine?.setEnabled(this.musicEnabled);
  if(this.musicEnabled)this.unlock();
  return this.musicEnabled;
 }
 // ---- Sampled announcer voice pack -----------------------------------------
 // Load the OmniVoice pack. `clips` installs a manifest directly (tests and
 // hosts that already fetched it); otherwise the URL is fetched once. Returns
 // the installed pack, or null while a fetch is in flight.
 loadAnnouncerPack(opts={}){
  if(this.announcerPack)return this.announcerPack;
  const url=typeof opts.url==='string'?opts.url:this.announcerPackUrl;
  const base=typeof opts.base==='string'?opts.base:this.announcerPackBase;
  if(Array.isArray(opts.clips))return this._installAnnouncerPack(opts.clips,base);
  if(this._announcerPackPromise)return null;
  const fetchFn=opts.fetchFn??this.announcerFetch??(typeof fetch==='function'?fetch.bind(globalThis):null);
  if(!fetchFn||!url)return null;
  this._announcerPackPromise=Promise.resolve().then(()=>fetchFn(url)).then(res=>res&&typeof res.json==='function'?res.json():res).then(data=>{const list=Array.isArray(data?.clips)?data.clips:null;if(list&&!this.announcerPack)this._installAnnouncerPack(list,base);return this.announcerPack;}).catch(()=>null).finally(()=>{this._announcerPackPromise=null;});
  return null;
 }
 _installAnnouncerPack(clips,baseUrl){
  let selector=null;
  try{selector=createAnnouncerSelector(clips,()=>mixUnit(this._announcerTake++));}catch{selector=null;}
  if(!selector)return null;
  const byCue=new Map();
  for(const clip of clips){if(!clip||typeof clip.file!=='string'||typeof clip.cue!=='string')continue;const group=byCue.get(clip.cue)??[];group.push(clip);byCue.set(clip.cue,group);}
  this.announcerPack={baseUrl:typeof baseUrl==='string'&&baseUrl?baseUrl:this.announcerPackBase,selector,byCue,buffers:new Map(),pending:new Map(),failed:new Set()};
  return this.announcerPack;
 }
 // Kick (and cache) one take's decode. Only an already-decoded buffer is
 // returned, so a sampled beat is never played late: the procedural cue covers
 // the first hearing and the take is ready from the next one.
 _announcerBuffer(clip){
  const pack=this.announcerPack;
  if(!pack||!this.ctx||!clip?.file)return null;
  const key=clip.file,ready=pack.buffers.get(key);
  if(ready)return ready;
  if(pack.failed.has(key)||pack.pending.has(key))return null;
  const ctx=this.ctx,fetchFn=this.announcerFetch??(typeof fetch==='function'?fetch.bind(globalThis):null);
  if(!fetchFn||typeof ctx.decodeAudioData!=='function'){pack.failed.add(key);return null;}
  const task=Promise.resolve().then(()=>fetchFn(`${pack.baseUrl}/${clip.file}`)).then(res=>{if(!res||res.ok===false)throw new Error('announcer fetch failed');return res.arrayBuffer();}).then(bytes=>new Promise((resolve,reject)=>{try{ctx.decodeAudioData(bytes,resolve,reject);}catch(error){reject(error);}})).then(buffer=>{if(buffer&&this.announcerPack===pack)pack.buffers.set(key,buffer);return buffer??null;}).catch(()=>{if(this.announcerPack===pack)pack.failed.add(key);return null;}).finally(()=>{try{pack.pending.delete(key);}catch{}});
  pack.pending.set(key,task);
  return null;
 }
 // Returns 'played' when a decoded take started, 'busy' when another take is
 // still speaking (the cue is dropped rather than talking over it) and false
 // when no sampled take was available. Every take of the cue is decoded on
 // first use so rotation is fully sampled from the second beat onward, and a
 // chosen take that is still streaming falls back to any decoded sibling
 // rather than dropping to the synth voice.
 _playAnnouncerTake(cueId,now){
  const pack=this.announcerPack;
  if(!pack)return false;
  if(now<this._announcerVoiceUntil)return 'busy';
  const group=pack.byCue.get(cueId);
  if(!group||!group.length)return false;
  for(const clip of group)this._announcerBuffer(clip);
  const clip=pack.selector(cueId);
  const chosen=clip?this._announcerBuffer(clip):null;
  if(chosen)return this._startAnnouncerTake(chosen,now);
  const ready=group.find(candidate=>pack.buffers.has(candidate.file));
  return ready?this._startAnnouncerTake(pack.buffers.get(ready.file),now):false;
 }
 _startAnnouncerTake(buffer,now){
  const duration=Math.min(12,Math.max(.12,Number(buffer.duration)||1))+.08,gain=cl(Number(this.announcerGain)||.9,.2,1.4);
  let played=false;
  this._play(duration,0,(t,out,nodes)=>{const src=this.ctx.createBufferSource();src.buffer=buffer;const g=this.ctx.createGain();g.gain.value=gain;src.connect(g);g.connect(out);try{src.start(t);src.stop(t+duration);}catch{}nodes.push(src,g);played=true;});
  if(!played)return false;
  this._announcerVoiceUntil=now+duration;
  return 'played';
 }
 // Optional announcer cue: a short two-note motif keyed by mode event. A short
 // per-cue cooldown dedupes the two event paths that can report the same moment
 // (view effect dispatch and the HUD snapshot), so one event makes one sound.
 // The callout owns the front of the mix: one short, bounded duck under it.
 // A decoded sampled take owns the beat outright; until it is ready the
 // procedural motif covers this one and the fetch/decode runs for next time.
 announcerCue(type){
  const cue=ANNOUNCE_CUES[type];if(!cue)return null;
  if(!this.announcer||!this.ctx||this.muted)return {cue:cue.id,played:false};
  const now=this.ctx.currentTime||0;
  const last=this._announceAt.get(cue.id);
  if(Number.isFinite(last)&&now-last<.25)return {cue:cue.id,played:false,deduped:true};
  this._announceAt.set(cue.id,now);
  const mid=cue.mid??cue.end;
  this._duckMusic(.32,.45);
  const sampled=this._playAnnouncerTake(cue.id,now);
  if(sampled==='played'){this.lastCue=cue.id;return {cue:cue.id,played:true,sampled:true};}
  if(sampled==='busy')return {cue:cue.id,played:false,sampled:true,busy:true};
  this._play(cue.length+.1,0,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:cue.freq,duration:cue.length*.45,type:'triangle',gain:.06,end:mid});this._tone(t+cue.length*.5,out,nodes,{freq:mid,duration:cue.length*.45,type:'triangle',gain:.05,end:cue.end});this._tone(t+cue.length*.82,out,nodes,{freq:cue.end,duration:cue.length*.32,type:'sine',gain:.035,end:cue.end*1.06});});
  this.lastCue=cue.id;return {cue:cue.id,played:true};
 }
 // High-value announcer dispatch: the per-cue cooldown plus a global cadence
 // guard, so a cluster of match beats (a wave, a boss phase and a capture in
 // the same second) makes one callout rather than three. One token per cue.
 announcerEvent(type){
  const cue=ANNOUNCE_CUES[type];if(!cue)return null;
  if(!this.announcer||!this.ctx||this.muted)return {cue:cue.id,played:false};
  const now=this.ctx.currentTime||0;
  if(Number.isFinite(this._announceCadence)&&now-this._announceCadence<ANNOUNCE_CADENCE-1e-6)return {cue:cue.id,played:false,cadence:true};
  const result=this.announcerCue(type);
  if(result&&result.played===true)this._announceCadence=now;
  return result;
 }
 // Event-stream dispatch for the high-value table. Actor-scoped beats (a
 // promotion, an upgrade, a bounty) are announced for the local player only;
 // world beats are announced for every player.
 _announceHighValue(e,local){
  if(this.announcer!==true||!e||typeof e.type!=='string')return false;
  const actorScoped=HIGH_VALUE_ANNOUNCE[e.type];
  if(actorScoped===undefined)return false;
  if(actorScoped===true&&!local)return false;
  return this.announcerEvent(e.type)?.played===true;
 }
  // Spectator audio follows the watched actor as well as the local player.
  _isLocal(e,player){if(!e||!player)return false;if(e.actor===player.id||e.actorId===player.id||e.driver===player.id||Boolean(e.occupants?.includes(player.id)))return true;return Boolean(player.spectator===true&&player.spectatorTarget!=null&&(e.actor===player.spectatorTarget||e.actorId===player.spectatorTarget||e.driver===player.spectatorTarget||e.occupants?.includes(player.spectatorTarget)));}
 _isScorer(source,player){if(source==null||!player)return false;return source===player.id||(player.spectator===true&&player.spectatorTarget!=null&&source===player.spectatorTarget);}
 // Confirmation chirp layered into the death voice: a short rising pair so a
 // scoring player hears the kill without spending a second voice slot.
 _killConfirm(t,out,nodes,vol=1){const gain=Math.min(.1,.075*vol);this._tone(t+.02,out,nodes,{freq:1180,duration:.08,type:'triangle',gain,end:1860});this._tone(t+.09,out,nodes,{freq:1660,duration:.07,type:'sine',gain:gain*.7,end:840});}
  // The historical generic death voice. Kept bit-for-bit so an event without a
  // planner family (or with an unknown one) sounds exactly as it always did.
  _legacyDeath(t,out,nodes,g,local){this._noise(t,out,nodes,{duration:.4,gain:.35*g,type:'lowpass',freq:1200,sweep:120,q:.7});this._tone(t,out,nodes,{freq:local?220:180,duration:.45,type:'sawtooth',gain:.12*g,end:40});this._noise(t+.05,out,nodes,{duration:.22,gain:.16*g,type:'bandpass',freq:700,sweep:200,q:.6});}
  // Style-aware death synthesis. One family replaces the generic voice (never
  // stacked on top of it) and the whole variant lives in the caller's single
  // voice token, on the caller's `t`, with the same `vol`/pan contract. Pitch
  // and level micro-variation come only from the event seed, so identical
  // events synthesize identically on every client and replay.
  _deathVoice(t,out,nodes,{sound=null,vol=1,local=false,seed=0}={}){
   const g=cl(vol,0,1);
   if(!sound){this._legacyDeath(t,out,nodes,g,local);return;}
   const pitch=1+(mixUnit(seed)-.5)*.1,level=g*(.96+mixUnit((seed^0x85ebca6b)>>>0)*.08);
   if(sound==='thud'){
    this._noise(t,out,nodes,{duration:.3,gain:.3*level,type:'lowpass',freq:520*pitch,sweep:80,q:.8,attack:.004});
    this._tone(t,out,nodes,{freq:78*pitch,duration:.4,type:'sine',gain:.19*level,end:30});
    this._noise(t+.03,out,nodes,{duration:.2,gain:.12*level,type:'bandpass',freq:190*pitch,sweep:60,q:.9});
   }else if(sound==='pop'){
    this._noise(t,out,nodes,{duration:.03,attack:.0008,gain:.26*level,type:'highpass',freq:1800*pitch,sweep:600});
    this._tone(t,out,nodes,{freq:430*pitch,duration:.16,type:'sine',gain:.14*level,end:95});
    this._noise(t+.005,out,nodes,{duration:.12,gain:.18*level,type:'bandpass',freq:900*pitch,sweep:280,q:1.4});
    this._tone(t+.02,out,nodes,{freq:210*pitch,duration:.1,type:'triangle',gain:.08*level,end:70});
   }else if(sound==='splat'){
    this._noise(t,out,nodes,{duration:.42,attack:.006,gain:.3*level,type:'lowpass',freq:1600*pitch,sweep:160,q:.6});
    this._tone(t,out,nodes,{freq:150*pitch,duration:.3,type:'sine',gain:.08*level,end:45});
    this._noise(t+.02,out,nodes,{duration:.3,gain:.17*level,type:'bandpass',freq:520*pitch,sweep:90,q:1.1});
    this._noise(t+.01,out,nodes,{duration:.06,gain:.09*level,type:'highpass',freq:2400*pitch,sweep:800});
   }else if(sound==='burst'){
    this._noise(t,out,nodes,{duration:.04,attack:.0008,gain:.22*level,type:'bandpass',freq:2600*pitch,sweep:400,q:1});
    this._noise(t+.005,out,nodes,{duration:.38,gain:.26*level,type:'lowpass',freq:900*pitch,sweep:70,q:.7});
    this._tone(t,out,nodes,{freq:112*pitch,duration:.35,type:'sine',gain:.15*level,end:32});
    this._tone(t+.01,out,nodes,{freq:265*pitch,duration:.12,type:'square',gain:.06*level,end:80});
   }else if(sound==='boom'){
    this._noise(t,out,nodes,{duration:.55,attack:.012,gain:.28*level,type:'lowpass',freq:640*pitch,sweep:50,q:.8});
    this._tone(t,out,nodes,{freq:54*pitch,duration:.6,type:'sine',gain:.18*level,end:24});
    this._tone(t,out,nodes,{freq:38*pitch,duration:.7,type:'sine',gain:.1*level,end:20});
    this._noise(t+.08,out,nodes,{duration:.4,gain:.09*level,type:'bandpass',freq:300*pitch,sweep:90,q:.5,attack:.03});
   }else if(sound==='zap'){
    this._noise(t,out,nodes,{duration:.1,gain:.24*level,type:'highpass',freq:2600*pitch,sweep:900});
    this._tone(t,out,nodes,{freq:1400*pitch,duration:.12,type:'sawtooth',gain:.13*level,end:180});
    this._tone(t+.02,out,nodes,{freq:320*pitch,duration:.14,type:'square',gain:.08*level,end:2200});
    this._noise(t+.04,out,nodes,{duration:.18,gain:.11*level,type:'bandpass',freq:4200*pitch,sweep:1200,q:.8});
   }else this._legacyDeath(t,out,nodes,g,local);
  }
  // Short bright hit-confirm bell for precision or high-damage hits. Layered
  // over the existing hitmarker inside that voice token; `amount` and the
  // optional critical/headshot flags are the only inputs. Level is bounded to
  // the hitmarker so a chip hit stays quiet and a crit gains a top partial.
  _hitBell(t,out,nodes,{amount=0,precision=false,vol=1}={}){
   const strength=cl(Number(amount)/48,0,1),level=cl(vol,0,1)*(.55+.45*strength);
   this._noise(t,out,nodes,{duration:.018,attack:.0008,gain:.2*level,type:'highpass',freq:3400,sweep:5200});
   this._tone(t,out,nodes,{freq:2480,duration:.07,type:'triangle',gain:.055*level});
   this._tone(t+.012,out,nodes,{freq:3720,duration:.09,type:'sine',gain:.04*level});
   if(precision)this._tone(t+.026,out,nodes,{freq:4960,duration:.05,type:'sine',gain:.028*level});
  }
  _makeNoise(){const ctx=this.ctx,length=Math.max(1,Math.floor(ctx.sampleRate)),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0);let last=0;for(let i=0;i<length;i++){const white=Math.random()*2-1;last=(last+.02*white)/1.02;data[i]=white*.75+last*.5;}return buffer;}
  _dest(pan){const out=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(out.pan)out.pan.value=cl(pan||0,-1,1);out.connect(this.effectsBus||this.master);return out;}
  _play(duration,pan,build,opts){if(!this.ctx||this.muted||this.voices.size>=30)return;const t=this.ctx.currentTime,out=this._dest(pan),nodes=[out],token={nodes};if(opts&&opts.send>0&&this.space){try{const snd=this.ctx.createGain();snd.gain.value=cl(Number(opts.send)||0,0,1);out.connect(snd);snd.connect(this.space.send);nodes.push(snd);}catch{}}build(t,out,nodes);this.voices.add(token);token.timer=setTimeout(()=>{for(const n of nodes){try{n.disconnect();}catch{}}this.voices.delete(token);},Math.max(30,(duration+.15)*1000));}
  _noise(t,out,nodes,{duration=.08,gain=.1,type='bandpass',freq=800,q=1,sweep=null,attack=.002}){if(!this.ctx||!this.ctx.createBufferSource||typeof this.ctx.createBiquadFilter!=='function')return;const src=this.ctx.createBufferSource();src.buffer=this.noiseBuffer;src.loop=true;const f=this.ctx.createBiquadFilter();f.type=type;f.frequency.setValueAtTime(Math.max(30,freq),t);f.Q.value=q;if(sweep)f.frequency.exponentialRampToValueAtTime(Math.max(30,sweep),t+duration);const g=this.ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(Math.max(.0002,gain),t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+duration);src.connect(f);f.connect(g);g.connect(out);src.start(t);src.stop(t+duration+.03);nodes.push(src,f,g);}
  _tone(t,out,nodes,{freq,duration=.08,type='sine',gain=.05,end=0,attack=.003}){const o=this.ctx.createOscillator();o.type=type;o.frequency.setValueAtTime(Math.max(20,freq),t);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);const g=this.ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(Math.max(.0002,gain),t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g);g.connect(out);o.start(t);o.stop(t+duration+.03);nodes.push(o,g);}
 tone(freq,duration=.08,type='sine',gain=.04,end=0){this._play(duration,0,(t,out,nodes)=>this._tone(t,out,nodes,{freq,duration,type,gain,end,attack:.006}));}
  _panFor(pos,player){if(!pos||!player||!Number.isFinite(pos.x)||!Number.isFinite(player.x))return 0;const dx=pos.x-(player.x||0),dz=pos.z-(player.z||0),dist=Math.hypot(dx,dz)||1,rx=Math.cos(player.yaw||0),rz=-Math.sin(player.yaw||0);return cl((dx*rx+dz*rz)/dist*.9,-1,1);}
  _falloff(pos,player,max=36){if(!pos||!Number.isFinite(pos.x))return 0;if(!player||!Number.isFinite(player.x))return 1;return Math.max(0,1-Math.hypot(pos.x-(player.x||0),pos.z-(player.z||0))/max);}
  _click(pan,vol=1,gain=.06,freq=1600){this._play(.09,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.03,gain:gain*vol,type:'highpass',freq:900,sweep:freq});this._tone(t,out,nodes,{freq:freq*.8,duration:.03,type:'square',gain:.02*vol,end:200});});}
  _gunshot(e,local,pan,vol,player){
   const feel=WEAPONS[e.weapon]?.feel||{},s=e.type==='launch'?feel.launch:feel.shot,style=GUN_STYLES[e.weapon]||'rifle',[freq,duration,type,gain]=s||REPORTS[e.weapon]||REPORTS[0],d=cl((duration||.08)*1.5,.06,.3);
   const shape=reportStyle(style);
   const seed=eventSeed(e)||(this.reportSerial=(this.reportSerial+1)>>>0);
   const vary=reportVariation(style,seed);
   // Distance shaping: a far report keeps its body but loses its high end, so
   // distant fights stay audible without the fatigue of full-bright cracks.
   const near=cl(vol,0,1),bright=.55+.45*near,base=Math.max(60,(freq||320)*shape.pitch*vary.pitch),heavy=style==='heavy',tail=shape.tail*vary.tail;
   this._play(d+.08+shape.tail*.12,pan,(t,out,nodes)=>{
    // Layered report: transient crack, filtered body, tonal thump, sub, one
    // family layer and a decaying tail. Still exactly one voice token per shot,
    // so automatic fire cannot grow the voice count.
    this._noise(t,out,nodes,{duration:.032,attack:.0006,gain:.6*vol*shape.transient*bright,type:heavy?'lowpass':'highpass',freq:heavy?Math.max(90,base*.9):base*1.5*vary.bright,sweep:heavy?160:base*.6});
    this._noise(t,out,nodes,{duration:.06,gain:.34*vol*shape.body,type:heavy?'lowpass':'bandpass',freq:heavy?Math.max(120,base*.6):base*.75,q:.9,sweep:heavy?110:Math.max(50,base*.3)});
    this._tone(t,out,nodes,{freq:base,duration:Math.min(.14,d*.8),type:type||'square',gain:Math.min(.3,(gain||.05)*vol*3.2),end:style==='zap'?base*2.2:Math.max(40,base*.55)});
    this._tone(t,out,nodes,{freq:Math.max(60,base*.45),duration:Math.min(.2,d),type:'sine',gain:vol*shape.sub,end:50});
    if(shape.layers==='sizzle')this._noise(t+.01,out,nodes,{duration:.14,gain:.22*vol*bright,type:'bandpass',freq:1800,sweep:5200,q:.9});
    else if(shape.layers==='double')this._noise(t+.055,out,nodes,{duration:.09,gain:.3*vol,type:'lowpass',freq:520,sweep:200,q:.7});
    else if(shape.layers==='bloom'){this._noise(t+.02,out,nodes,{duration:.16,gain:.24*vol,type:'lowpass',freq:1200,sweep:460,q:.6});this._tone(t+.03,out,nodes,{freq:260,duration:.18,type:'triangle',gain:.12*vol,end:1200});}
    else if(shape.layers==='crack')this._noise(t+.005,out,nodes,{duration:.04,gain:.45*vol,type:'bandpass',freq:2200,sweep:800,q:1.8});
    else if(shape.layers==='tight')this._noise(t+.012,out,nodes,{duration:.03,gain:.35*vol,type:'highpass',freq:1400,sweep:600});
    else if(shape.layers==='supersonic')this._noise(t+.02,out,nodes,{duration:.05,gain:.2*vol,type:'highpass',freq:2600,sweep:900});
    if(tail>.04)this._noise(t+.03,out,nodes,{duration:.08+.22*tail,gain:.12*vol*tail,type:'bandpass',freq:shape.tailFreq*bright,sweep:shape.tailFreq*.4,q:.55,attack:.02});
    this._shotImpact(t,out,nodes,e,local,player,vol);
   },{send:(.2+.3*Math.min(1,tail))*vol});
  }
  // Surface-aware impact/ricochet at a shot's endpoint when it hit geometry. A
  // truthy `hit` is an actor and is already confirmed by the damage event, so
  // only misses add layers. Shared by the normal and alt reports.
  _shotImpact(t,out,nodes,e,local,player,vol){
   if((e.hit==null||e.hit===false)&&e.to&&Number.isFinite(e.to.x)&&player){
    const dist=Math.hypot((e.to.x||0)-(player.x||0),(e.to.z||0)-(player.z||0));
    const iv=(local?Math.max(0,.5*(1-dist/26)):Math.max(0,1-dist/30)*.8)*vol;
    if(iv>.02)this._impact(t+.012,out,nodes,{vol:iv,surface:e.surface??e.material,ricochet:dist>12});
   }
  }
  // Alt-fire report: one voice token that replaces the normal gunshot (never
  // layered on top). The id resolves from the event first, then the weapon's alt
  // spec; an unresolvable alt returns false so the caller keeps `_gunshot`.
  // Routing, panning, falloff, the surface impact and the shared space send all
  // follow the normal report's contract.
  _altShot(e,local,pan,vol,player){
   const altId=altVoiceFor(e);
   if(!altId)return false;
   const seed=eventSeed(e)||(this.reportSerial=(this.reportSerial+1)>>>0);
   // Flak shrapnel reuses the alt `shot` shape at impact time (bomb spec): voice
   // each shard as one quiet tick instead of replaying the launch report. The
   // same-tick shards share `time`, so the report dedupe collapses them to one.
   if(e.shrapnel!=null){
    const shard=cl(vol,0,1),shardPitch=altVariation(seed).pitch;
    this._play(.14,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.04,attack:.0008,gain:.2*shard,type:'highpass',freq:2600,sweep:900,q:.9});
     this._tone(t,out,nodes,{freq:880*shardPitch,duration:.05,type:'triangle',gain:.055*shard,end:360});
    },{send:.08*shard});
    return true;
   }
   this._play(ALT_VOICE_DURATIONS[altId]??.34,pan,(t,out,nodes)=>{
    this._altVoice(altId,t,out,nodes,{vol,seed});
    this._shotImpact(t,out,nodes,e,local,player,vol);
   },{send:.2*cl(vol,0,1)});
   return true;
  }
  // The ten alt voices. Every branch is one bounded layer set inside the
  // caller's single voice token, mixed at or below the matching normal report's
  // level, with `p`/`g` seeded pitch and level. Never plays the generic report.
  _altVoice(altId,t,out,nodes,{vol=1,seed=0}={}){
   const v=altVariation(seed),g=cl(vol,0,1)*v.level,p=v.pitch;
   if(altId==='salvo'){
    // Three quick chirps fanned across the trigger pull.
    for(let i=0;i<3;i++){
     const at=t+i*.055,step=i*.5;
     this._noise(at,out,nodes,{duration:.05,attack:.001,gain:.19*g,type:'bandpass',freq:(1650+step*340)*p,sweep:(2600+step*520)*p,q:1.2});
     this._tone(at,out,nodes,{freq:(620+step*180)*p,duration:.055,type:'triangle',gain:.075*g,end:(950+step*260)*p});
    }
   }else if(altId==='cluster'){
    // Deep thump then the bomblets splitting off in a short crackle.
    this._noise(t,out,nodes,{duration:.3,attack:.004,gain:.46*g,type:'lowpass',freq:430*p,sweep:70,q:.8});
    this._tone(t,out,nodes,{freq:76*p,duration:.34,type:'sine',gain:.22*g,end:30});
    this._tone(t,out,nodes,{freq:50*p,duration:.36,type:'sine',gain:.11*g,end:22});
    for(let i=0;i<3;i++)this._noise(t+.13+i*.085,out,nodes,{duration:.05,gain:.15*g,type:'bandpass',freq:(1850+i*520)*p,sweep:(680+i*210)*p,q:1.5});
   }else if(altId==='overload'){
    // A quick charge bite, a descending beam and a sizzle tail.
    this._tone(t,out,nodes,{freq:380*p,duration:.07,type:'sawtooth',gain:.1*g,end:1180*p});
    this._tone(t+.05,out,nodes,{freq:1500*p,duration:.24,type:'sawtooth',gain:.15*g,end:250});
    this._tone(t+.05,out,nodes,{freq:2500*p,duration:.2,type:'triangle',gain:.08*g,end:420});
    this._noise(t+.04,out,nodes,{duration:.22,gain:.22*g,type:'bandpass',freq:2400*p,sweep:620,q:1.1});
    this._noise(t+.12,out,nodes,{duration:.2,gain:.13*g,type:'bandpass',freq:1700,sweep:5200,q:.9,attack:.02});
   }else if(altId==='slug'){
    // One dense, punchy report with a much shorter tail than the shotgun burst.
    this._noise(t,out,nodes,{duration:.05,attack:.0007,gain:.52*g,type:'lowpass',freq:880*p,sweep:170,q:1});
    this._noise(t+.004,out,nodes,{duration:.11,gain:.32*g,type:'lowpass',freq:520*p,sweep:110,q:.8});
    this._tone(t,out,nodes,{freq:128*p,duration:.17,type:'square',gain:.18*g,end:52});
    this._tone(t,out,nodes,{freq:62*p,duration:.26,type:'sine',gain:.22*g,end:28});
   }else if(altId==='mortar'){
    // Soft lob: a lazy two-step whistle over an airy whoosh.
    this._tone(t,out,nodes,{freq:520*p,duration:.14,type:'sine',gain:.09*g,end:780});
    this._tone(t+.09,out,nodes,{freq:780*p,duration:.16,type:'sine',gain:.065*g,end:560});
    this._noise(t,out,nodes,{duration:.28,gain:.11*g,type:'bandpass',freq:560,sweep:1500,q:.7,attack:.03});
    this._noise(t+.2,out,nodes,{duration:.1,gain:.06*g,type:'bandpass',freq:900,sweep:340,q:.8});
   }else if(altId==='mine'){
    // Quiet deploy chirp and two soft sensor ticks as it arms.
    this._tone(t,out,nodes,{freq:660*p,duration:.09,type:'triangle',gain:.07*g,end:940*p});
    this._noise(t,out,nodes,{duration:.06,gain:.07*g,type:'bandpass',freq:1500*p,sweep:900,q:1.3});
    this._tone(t+.14,out,nodes,{freq:1500*p,duration:.035,type:'square',gain:.05*g});
    this._tone(t+.26,out,nodes,{freq:1180*p,duration:.03,type:'square',gain:.04*g});
   }else if(altId==='chain'){
    // A descending stack of three zaps, each quieter than the last.
    for(let i=0;i<3;i++){
     const at=t+i*.05,fade=1-i*.22;
     this._noise(at,out,nodes,{duration:.06,attack:.0008,gain:.23*g*fade,type:'highpass',freq:(2600+i*520)*p,sweep:(1000+i*260)*p});
     this._tone(at,out,nodes,{freq:(1450-i*260)*p,duration:.075,type:'sawtooth',gain:.1*g*fade,end:(430-i*70)*p});
    }
   }else if(altId==='bomb'){
    // Hollow launch pop: a bright mouth transient over a short empty body.
    this._noise(t,out,nodes,{duration:.04,attack:.0007,gain:.38*g,type:'bandpass',freq:2100*p,sweep:700,q:1.1});
    this._noise(t+.006,out,nodes,{duration:.17,gain:.2*g,type:'lowpass',freq:860*p,sweep:220,q:.8});
    this._tone(t,out,nodes,{freq:205*p,duration:.2,type:'triangle',gain:.13*g,end:78});
    this._tone(t,out,nodes,{freq:94*p,duration:.24,type:'sine',gain:.11*g,end:38});
   }else if(altId==='double'){
    // Two crisp, evenly spaced taps.
    for(let i=0;i<2;i++){
     const at=t+i*.07;
     this._noise(at,out,nodes,{duration:.03,attack:.0006,gain:.38*g,type:'highpass',freq:(2000+i*180)*p,sweep:(3400+i*240)*p});
     this._tone(at,out,nodes,{freq:(560-i*50)*p,duration:.06,type:'square',gain:.11*g,end:(230-i*20)*p});
     this._tone(at,out,nodes,{freq:175*p,duration:.09,type:'sine',gain:.09*g,end:58});
    }
   }else if(altId==='twin'){
    // A fast doubled rattle: four alternating ticks with the second pair softer.
    for(let i=0;i<4;i++){
     const at=t+i*.032,accent=i%2===0?1:.82;
     this._noise(at,out,nodes,{duration:.028,attack:.0006,gain:.18*g*accent,type:'highpass',freq:(1850+i*150)*p,sweep:2700+i*90});
     this._noise(at,out,nodes,{duration:.035,gain:.09*g*accent,type:'lowpass',freq:640*p,sweep:240,q:.8});
     this._tone(at,out,nodes,{freq:(148+i*9)*p,duration:.04,type:'square',gain:.05*g*accent,end:68});
    }
   }
  }
  // Alt-transform foley: a short mechanical deploy when the held mode flips on,
  // a lighter stow when it flips off. One quiet voice token, seeded, and voiced
  // only for the local/self actor or a nearby one like the other weapon foley.
  _altState(pan,vol,on,seed=0){
   const v=altVariation(seed),g=cl(vol,0,1)*v.level,p=v.pitch;
   if(on){
    this._play(.26,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.05,attack:.001,gain:.16*g,type:'bandpass',freq:1500,sweep:650,q:1.4});
     this._tone(t+.01,out,nodes,{freq:210*p,duration:.12,type:'square',gain:.06*g,end:520});
     this._noise(t+.05,out,nodes,{duration:.12,gain:.1*g,type:'lowpass',freq:720,sweep:170,q:.9});
     this._tone(t+.06,out,nodes,{freq:118,duration:.14,type:'triangle',gain:.07*g,end:180});
    },{send:.12*cl(vol,0,1)});
   }else{
    this._play(.2,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.06,gain:.09*g,type:'lowpass',freq:520,sweep:190,q:.8});
     this._tone(t,out,nodes,{freq:170*p,duration:.1,type:'triangle',gain:.05*g,end:72});
     this._noise(t+.03,out,nodes,{duration:.07,gain:.055*g,type:'bandpass',freq:900,sweep:420,q:1});
    },{send:.1*cl(vol,0,1)});
   }
  }
  // Surface-aware bullet impact/ricochet: one transient, one material tick, an
  // optional ricochet whine and up to three debris ticks. Bounded per impact.
  _impact(t,out,nodes,{vol=1,surface=null,ricochet=false}={}){
   const p=impactProfile(surface),v=cl(vol,0,1),decay=p.decay??1;
   this._noise(t,out,nodes,{duration:.045*decay,attack:.0008,gain:p.gain*v,type:p.type,freq:p.freq*(ricochet?1.35:1),sweep:p.freq*.45,q:p.q});
   this._tone(t,out,nodes,{freq:p.tone,duration:.05*decay,type:'square',gain:Math.min(.06,p.gain*.22*v),end:p.end});
   if(p.ring)this._tone(t+.005,out,nodes,{freq:p.ring*(ricochet?1.12:1),duration:.18*decay,type:'sine',gain:Math.min(.05,.03*v),end:p.ring*.55});
   if(p.splash)this._noise(t+.01,out,nodes,{duration:.09,gain:p.gain*.5*v,type:'bandpass',freq:1500,sweep:500,q:.7});
   const debris=Math.min(3,Math.round(p.debris||0));
   for(let i=0;i<debris;i++)this._noise(t+.02+i*.035,out,nodes,{duration:.03,gain:p.gain*.3*v,type:'bandpass',freq:p.freq*(.6+i*.25),sweep:p.freq*.3,q:1});
  }
  // Match-beat motif player: one voice token, retuned to the active mode root,
  // with an optional filtered shimmer. Bounded to the motif's note count. A cue
  // may carry an optional `tail` second layer (harness activations): a quiet
  // impact/tone that still lives inside the same voice token.
  _beat(cue,pan,vol=1,tailSend=.22){
   if(!cue||vol<=.02)return;
   const root=this.theme?.root??58,notes=cue.notes||[],layer=cue.tail;
   this._play(cue.length+(notes.length-1)*cue.step+.12+(layer?(layer.delay||0)+(layer.duration??.18):0),pan,(t,out,nodes)=>{
    notes.forEach((semi,i)=>{const f=root*Math.pow(2,Number(semi)/12);this._tone(t+i*cue.step,out,nodes,{freq:f,duration:cue.length,type:cue.type||'triangle',gain:(cue.gain||.06)*vol,end:f*1.42});});
    if(cue.shimmer)this._noise(t+.01,out,nodes,{duration:.24,gain:.05*vol,type:'highpass',freq:3000,sweep:1400,q:.6,attack:.015});
    if(layer){
     const at=t+(layer.delay||0),duration=layer.duration??.18;
     if(layer.noise>0)this._noise(at,out,nodes,{duration,gain:cl(layer.noiseGain,0,.05)*vol,type:'bandpass',freq:layer.noise,sweep:layer.noiseSweep,q:1.1,attack:.004});
     this._tone(at,out,nodes,{freq:layer.freq,duration,type:layer.type||'sine',gain:cl(layer.gain,0,.06)*vol,end:layer.end??layer.freq*.5});
    }
   },{send:tailSend*vol});
  }
  // Mounted chaingun: a heavier, layered thump so it reads differently from the
  // pulse rifle. Slight per-shot pitch wobble gives the spinning-barrel texture.
  _chaingun(pan,vol=1){if(!this.ctx)return;const now=this.ctx.currentTime;if(now-(this.lastChain||0)<.03)return;this.lastChain=now;const pitch=.92+Math.random()*.18;this._play(.15,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.05,gain:.62*vol,type:'lowpass',freq:1500*pitch,sweep:320,q:.85,attack:.001});this._noise(t,out,nodes,{duration:.028,gain:.34*vol,type:'highpass',freq:2600*pitch,sweep:5600,q:.6,attack:.001});this._tone(t,out,nodes,{freq:150*pitch,duration:.06,type:'square',gain:.22*vol,end:58});this._tone(t,out,nodes,{freq:66*pitch,duration:.11,type:'sine',gain:.26*vol,end:34});this._noise(t+.035,out,nodes,{duration:.13,gain:.12*vol,type:'bandpass',freq:900*pitch,sweep:340,q:.6,attack:.015});},{send:.26*vol});}
 // Per-weapon reload foley. The counter drives three deterministic sequences so
 // repeated reloads do not sound mechanical; the insert click opens the reload
 // and a scheduled mag-in click lands at the event's own `duration` when the
 // stream supplies one (else the historical .2/.26 s cadence). An `end` event
 // cancels a pending click and seats the magazine immediately, so a start/end
 // pair makes exactly one seat click even across a replay that only sees `end`.
 // Voice cap and disposal are inherited from _play/_click.
 _reload(weapon,state,duration=null){
  if(state!=='start'&&state!=='end')return;
  const index=Number.isInteger(weapon)&&WEAPONS[weapon]?weapon:0,heavy=(WEAPONS[index]?.feel?.kick?.[2]??16)<14;
  if(state==='end'){
   const pending=this._reloadPending.get(index);
   if(pending){clearTimeout(pending.timer);this._reloadPending.delete(index);}
   this._reloadSeat(index,pending?pending.variant:null,heavy);
   return;
  }
  this.reloadVariant=(this.reloadVariant+1)%3;
  this._reloadInsert(index,heavy);
  const raw=Number(duration),seconds=Number.isFinite(raw)?cl(raw,.12,4):(heavy?.26:.2);
  const previous=this._reloadPending.get(index);
  if(previous)clearTimeout(previous.timer);
  const timer=setTimeout(()=>{
   this._reloadPending.delete(index);
   if(this.ctx&&!this.muted)this._reloadSeat(index,this.reloadVariant,heavy);
  },Math.round(seconds*1000));
  if(timer&&typeof timer.unref==='function')timer.unref();
  this._reloadPending.set(index,{timer,variant:this.reloadVariant});
 }
 // Magazine out: the weapon's own insert timbre (heavy weapons are duller and
 // lower, light weapons brighter and shorter). One click voice.
 _reloadInsert(index,heavy){
  this._click(0,1,.06,heavy?950:1200);
  if(heavy)this.tone(210,.04,'triangle',.02,150);
 }
 // Magazine in: a bright seating click plus, on the third sequence, a small
 // mechanical confirm tone. One click voice (plus one tone on variant 2).
 _reloadSeat(index,variant,heavy){
  const light=WEAPONS[index]?.feel?.kick?.[2]??16;
  const freq=cl(1450+light*22,1500,2100);
  this._click(0,1,.05,freq);
  if(variant===2)this.tone(heavy?180:320,.05,'square',.02,heavy?120:220);
 }
 // Empty chamber: a hollow, distinct dryfire identity rather than a generic
 // click. One voice with a spring snap over an empty body thunk.
 _dryfire(pan=0){
  this._play(.15,pan,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.022,attack:.0006,gain:.2,type:'highpass',freq:2800,sweep:1300,q:.9});
   this._tone(t,out,nodes,{freq:1240,duration:.05,type:'square',gain:.045,end:430});
   this._tone(t+.028,out,nodes,{freq:176,duration:.08,type:'triangle',gain:.07,end:78});
  });
 }
 // Weapon switch foley split into a holster (dull weight drop) and a draw
 // (bright slide plus seating click). The new weapon's handling weight picks the
 // timbre; a non-request switch (a scripted/auto swap) is shorter. One voice.
 _weaponSwitch(weapon,source){
  const index=Number.isInteger(weapon)&&WEAPONS[weapon]?weapon:0,heavy=(WEAPONS[index]?.feel?.kick?.[2]??16)<12,quick=source!=='request';
  this._play(quick?.16:.22,0,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.05,attack:.001,gain:heavy?.22:.17,type:'lowpass',freq:heavy?520:680,sweep:220,q:.9});
   this._tone(t,out,nodes,{freq:heavy?120:150,duration:.08,type:'triangle',gain:.06,end:58});
   const at=t+(quick?.07:.1);
   this._noise(at,out,nodes,{duration:.04,attack:.0007,gain:.2,type:'highpass',freq:heavy?1500:1900,sweep:heavy?2600:3200});
   this._tone(at,out,nodes,{freq:heavy?690:920,duration:.06,type:'square',gain:.045,end:heavy?280:360});
   this._tone(at+.01,out,nodes,{freq:heavy?210:260,duration:.09,type:'sine',gain:.05,end:heavy?90:120});
  });
 }
 // Melee whoosh plus a surface-aware impact crack when it connects. The
 // 260 Hz whoosh sweep is the pinned melee identity; the impact layers below it
 // vary with the surface under the swing.
 _melee(weapon,hit,surface){
  this._play(.24,0,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.22,type:'bandpass',freq:900,sweep:260,q:.7});this._tone(t,out,nodes,{freq:220,duration:.12,type:'triangle',gain:.08,end:90});if(hit){this._noise(t+.05,out,nodes,{duration:.09,gain:.3,type:'lowpass',freq:700,sweep:200,q:.8});this._impact(t+.07,out,nodes,{vol:.9,surface});}},{send:.2});
 }
  // Distant thunder: a low, filtered rumble with a delayed onset and stereo
  // pan. Distance (0..1) controls the delay, brightness and gain so a close
  // strike cracks and a far one rolls. Reuses the shared voice cap/disposal.
  // Accepts the historical `{distance,pan,intensity}` object or the positional
  // `(pan,distance,intensity,seed?)` form; an optional seed deterministically
  // selects one of the frozen recipes, while no seed keeps the historical roll.
  thunder(a,distance,intensity,seed){
   const opts=a&&typeof a==='object'?a:{pan:a,distance,intensity,seed};
   const {distance:d0=.6,pan:p0=0,intensity:i0=1,seed:s0=null}=opts||{};
   if(!this.ctx||this.muted)return false;
   const d=cl(Number(d0)||0,0,1),vol=cl(Number(i0)||0,0,1)*(1-d*.55);
   if(vol<=.02)return false;
   const recipe=thunderRecipeFor(s0),delay=.06+d*1.5,pan=cl(Number(p0)||0,-1,1);
   setTimeout(()=>{if(!this.ctx||this.muted)return;this._play(.9+d*.7,pan,(t,out,nodes)=>{
    // Close strikes get a supersonic crack before the body; the tail rolls into
    // the shared space delay so far thunder trails across the arena.
    if(d<recipe.crack)this._noise(t,out,nodes,{duration:.08,attack:.001,gain:.34*vol*(1-d*2),type:'highpass',freq:1800,sweep:500});
    this._noise(t,out,nodes,{duration:.55+d*recipe.durScale,gain:recipe.bodyGain*vol,type:'lowpass',freq:recipe.bodyFreq-d*recipe.bodyDrop,sweep:recipe.bodySweep+d*recipe.bodyRise,q:.7,attack:.02});
    this._noise(t+.08,out,nodes,{duration:.3,gain:recipe.rollGain*vol,type:'lowpass',freq:recipe.rollFreq,sweep:recipe.rollSweep,q:.8,attack:.03});
    this._noise(t+.3,out,nodes,{duration:.5+d*recipe.durScale,gain:recipe.tailGain*vol,type:'bandpass',freq:recipe.tailFreq-d*recipe.tailDrop,sweep:recipe.tailSweep,q:.5,attack:.05});
    this._tone(t,out,nodes,{freq:recipe.lowFreq-d*recipe.lowDrop,duration:.7+d*recipe.durScale,type:'sine',gain:recipe.lowGain*vol,end:26});
    this._tone(t,out,nodes,{freq:recipe.highFreq-d*recipe.highDrop,duration:.85+d*recipe.durScale,type:'sine',gain:recipe.highGain*vol,end:22});
   },{send:.4*vol});},Math.round(delay*1000));
   return true;
  }
  // Landing thump scaled by impact speed and surface. The variant shifts the
  // body tone so repeated jumps do not phase into one sample; default surface
  // numbers are unchanged from phase 1.
  _landing(impact,weapon,surface){
  this.landVariant=(this.landVariant+1)%3;
  const sp=footstepProfile(surface),heavy=(WEAPONS[weapon]?.feel?.kick?.[2]??16)<12;
  this._play(.14,0,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.1,gain:(.05+.16*impact)*sp.gain,type:'lowpass',freq:420*sp.bright,sweep:160,q:.8*sp.q});this._tone(t,out,nodes,{freq:((heavy?76:90)+this.landVariant*8)*sp.body,duration:.12,type:'sine',gain:.05+.1*impact,end:45});if(sp.ring)this._tone(t+.01,out,nodes,{freq:sp.ring,duration:.1,type:'triangle',gain:.03+.04*impact,end:sp.ring*.5});if(sp.splash)this._noise(t+.015,out,nodes,{duration:.08,gain:(.04+.1*impact)*sp.gain,type:'bandpass',freq:1400,sweep:420,q:.7});});
 }
 // Footstep variant selection rotates deterministically per step; the weapon
 // family biases the frequency and the surface profile shapes the band, body
 // and optional ring/debris layers so metal, wood, sand etc. read distinctly.
 _footstep(speed,weapon,surface){
  this.stepVariant=(this.stepVariant+1)%3;
  const sp=footstepProfile(surface),heavy=(WEAPONS[weapon]?.feel?.kick?.[2]??16)<12,vol=Math.min(.13*sp.gain,(.03+speed*.012)*sp.gain);
  this._play(.09,0,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.06,gain:vol,type:'lowpass',freq:((heavy?620:800)*sp.bright)+this.stepVariant*90+Math.min(700,speed*45),sweep:360,q:.9*sp.q});
   this._tone(t,out,nodes,{freq:((heavy?90:110)*sp.body)+this.stepVariant*10,duration:.05,type:'sine',gain:vol*.5,end:60});
   if(sp.ring)this._tone(t+.008,out,nodes,{freq:sp.ring,duration:.07,type:'triangle',gain:vol*.5,end:sp.ring*.6});
   if(sp.splash)this._noise(t+.012,out,nodes,{duration:.07,gain:vol*.8,type:'bandpass',freq:1500,sweep:520,q:.7});
   const scatter=Math.min(3,Math.round(sp.scatter||0));
   for(let i=0;i<scatter;i++)this._noise(t+.018+i*.028,out,nodes,{duration:.025,gain:vol*.55,type:'bandpass',freq:1100*(.7+i*.3),sweep:380,q:1});
  });
 }
 // Take-off foley: gear/cloth push without a voice. One token per jump.
 _jump(surface,weapon){
  this.jumpVariant=(this.jumpVariant+1)%3;
  const sp=footstepProfile(surface),heavy=(WEAPONS[weapon]?.feel?.kick?.[2]??16)<12;
  this._play(.16,0,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.12,gain:heavy?.16:.11,type:'bandpass',freq:(heavy?520:680)*sp.bright+this.jumpVariant*40,sweep:300,q:.6});
   this._tone(t,out,nodes,{freq:((heavy?120:150)*sp.body)+this.jumpVariant*6,duration:.08,type:'triangle',gain:.05,end:70});
   if(sp.ring)this._tone(t+.008,out,nodes,{freq:sp.ring*.7,duration:.07,type:'triangle',gain:.03,end:sp.ring*.4});
  });
 }
 // Sliding friction tick, surface-aware; called on a bounded cadence from
 // update() so a long slide never grows the voice count.
 _slide(speed,surface){
  const sp=footstepProfile(surface),vol=Math.min(1,speed/7);
  this._play(.17,0,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.13,gain:.16*vol*sp.gain,type:'bandpass',freq:950*sp.bright,sweep:450,q:.7});
   this._noise(t+.02,out,nodes,{duration:.1,gain:.07*vol,type:'highpass',freq:1800,sweep:600,q:.6});
   if(sp.ring)this._tone(t,out,nodes,{freq:sp.ring*.6,duration:.08,type:'triangle',gain:.02*vol,end:sp.ring*.3});
   if(sp.scatter)this._noise(t+.04,out,nodes,{duration:.05,gain:.06*vol,type:'bandpass',freq:1200,sweep:420,q:.9});
  });
 }
 // Ejected shell casing: a short metallic tinkle with a surface-tinted decay
 // and a seeded spin pitch. One voice token per casing and a small cadence
 // throttle so a full-auto burst (or a second view callback) cannot stack a
 // per-shot coin drop. The view calls this next to its casing spawn; a muted
 // mix returns false before the throttle so unmuting is never blocked.
 shellCasing(pan=0,seed=0,surface=null){
  if(!this.ctx||this.muted)return false;
  const now=Number.isFinite(this.ctx.currentTime)?this.ctx.currentTime:0;
  if(this._shellAt!=null&&now-this._shellAt<.045)return false;
  this._shellAt=now;
  const hit=impactProfile(surface),bright=cl((hit.freq||1600)/1600,.5,2),decay=cl(hit.decay??1,.6,1.4),u=mixUnit((Number(seed)||0)>>>0);
  const spin=1+(u-.5)*.16;
  this._play(.2,cl(Number(pan)||0,-1,1),(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.03*decay,attack:.0007,gain:.14,type:'highpass',freq:3200*bright,sweep:1800*bright});
   this._tone(t,out,nodes,{freq:2150*spin*bright,duration:.06,type:'triangle',gain:.055,end:1450*spin});
   this._tone(t+.045,out,nodes,{freq:2960*spin,duration:.05,type:'sine',gain:.038,end:2380});
   this._tone(t+.095,out,nodes,{freq:1650*spin,duration:.07,type:'triangle',gain:.026,end:980});
  },{send:.12});
  return true;
 }
 // Bounded debris tail for explosions: up to `cap` deterministic chips.
 _debris(t,out,nodes,{vol=1,seed=0,cap=4}={}){
  const n=Math.max(0,Math.min(4,Math.round(cap)));
  for(let i=0;i<n;i++){
   const u=mixUnit((seed>>>0)+i*97);
   this._noise(t+.12+u*.5,out,nodes,{duration:.06+u*.08,gain:.16*vol*(1-i/Math.max(1,n)*.5),type:'bandpass',freq:500+u*1800,sweep:180+u*260,q:.8,attack:.004});
  }
 }
 // Auto match-start from the event stream: the first spawn inside the opening
 // window is the match's FIGHT moment. One flag holds it, so a reconnect that
 // replays the same spawn (or any later spawn) can never fire it twice.
 _maybeMatchStart(e){
  if(this._matchLive)return false;
  if(e?.type!=='spawn')return false;
  const t=Number(e.time);
  if(!Number.isFinite(t)||t<0||t>2.5)return false;
  return this.matchStart().played===true;
 }
 // Dynamic-music state hooks for the event stream: escalation/de-escalation and
 // the killstreak accent. Runs once per event id; pure state or a queued
 // response, so it never stacks a voice on the event's own motif.
 _musicEventState(e,local){
  const type=e?.type;
  if(typeof type!=='string')return;
  const up=ESCALATION_EVENTS[type];
  if(up){
   if(!this._claimMusicBeat(e.id,`esc:${type}`))return;
   this.setEscalation(Math.max(this.escalation+up.step,up.floor));
   return;
  }
  if(ESCALATION_CLEARS.includes(type)){
   if(!this._claimMusicBeat(e.id,`esc:${type}`))return;
   this.setEscalation(0);
   return;
  }
  if(ACCENT_EVENTS.includes(type)&&local){
   if(!this._claimMusicBeat(e.id,`accent:${type}`))return;
   if(this.announcer!==true)this._musicResponse('accent',{vol:1});
  }
 }
 // Bounded per-zone quantizer for the generic KOTH/domination `zone-progress`
 // stream, which otherwise fires on every integer percent. Only a quarter-step
 // bucket (25/50/75%), a contested flip or an owner/capture-team flip is a
 // meaningful beat; the first event for a zone seeds silently. State is capped.
 _zoneProgress(event){
  const zone=String(event.zone??'zone');
  const progress=cl(Number(event.progress)||0,0,100);
  const bucket=Math.min(3,Math.floor(progress/25));
  const team=event.team==null?null:event.team;
  const contested=event.contested===true;
  const previous=this._zoneAudio.get(zone)||null;
  this._zoneAudio.delete(zone);
  this._zoneAudio.set(zone,{bucket,team,contested});
  if(this._zoneAudio.size>64)this._zoneAudio.delete(this._zoneAudio.keys().next().value);
  if(!previous)return null;
  if(contested&&!previous.contested)return EVENT_CUES['zone-contested'];
  if(team!==previous.team)return EVENT_CUES['zone-progress'];
  if(bucket>previous.bucket&&bucket>=1)return EVENT_CUES['zone-progress'];
  return null;
 }
 // Bearing -> stereo pan for a local damage thud: 0 is ahead, positive is left.
 // Missing/NaN angles return exactly 0 (the historical centered thud).
 _damagePan(event){
  const raw=Number(event?.angle??event?.bearing);
  return Number.isFinite(raw)?(cl(-Math.sin(raw)*.9,-1,1)||0):0;
 }
 // Directional local damage thud. `angle` is the bearing of the damage source in
 // radians relative to the player's facing, as produced by hud.damageBearing
 // (0 = ahead, positive = left); it maps to a stereo pan of -sin(angle). A
 // missing or NaN angle falls back to the existing centered thud, so a caller
 // can never pan the mix wrongly. When the page calls it immediately after a
 // local `damage` event (the centered thud already landed this frame), it adds a
 // short panned accent instead of a second full thud, so one hit stays one
 // impact. One voice per call.
 hitDirection(angle,amount=0){
  const raw=Number(angle),directed=Number.isFinite(raw);
  const pan=directed?(cl(-Math.sin(raw)*.9,-1,1)||0):0;
  const strength=cl((Number(amount)||0)/40,0,1);
  const recent=this._lastLocalDamageAt!=null&&this.ctx&&Number.isFinite(this.ctx.currentTime)&&this.ctx.currentTime-this._lastLocalDamageAt<=.05;
  if(!this.ctx||this.muted)return {played:false,pan,directed,merged:false};
  if(recent){
   this._play(.12,pan,(t,out,nodes)=>{
    this._noise(t,out,nodes,{duration:.05,attack:.0008,gain:.14+.12*strength,type:'bandpass',freq:1800+600*strength,sweep:700,q:1.1});
    this._tone(t+.01,out,nodes,{freq:180+60*strength,duration:.08,type:'triangle',gain:.05+.05*strength,end:70});
   });
   return {played:true,pan,directed,merged:true};
  }
  this._play(.2,pan,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.14,gain:.34+.2*strength,type:'lowpass',freq:700+400*strength,sweep:200,q:.7});
   this._tone(t,out,nodes,{freq:150+40*strength,duration:.14,type:'triangle',gain:.15+.08*strength,end:60});
   if(directed)this._noise(t+.01,out,nodes,{duration:.06,gain:.1+.1*strength,type:'bandpass',freq:1900,sweep:600,q:1.1});
  });
  return {played:true,pan,directed,merged:false};
 }
 // Vehicle hull ping for the local occupant. `vehicle-damage` carries no
 // position, so only the local vehicle is voiced (a remote hull stays silent
 // rather than centered); the amount scales the metallic ping and the cabin gets
 // a muffled thud underneath. Rapid hits are throttled per vehicle.
 _vehicleDamage(event,player){
  if(player?.vehicleId==null||player.vehicleId!==event.vehicle)return false;
  const key=String(event.vehicle);
  const stamp=Number.isFinite(Number(event.time))?Number(event.time):(this.ctx?.currentTime||0);
  const last=this._vehicleHitAt.get(key);
  if(Number.isFinite(last)&&stamp-last<.05)return false;
  this._vehicleHitAt.delete(key);this._vehicleHitAt.set(key,stamp);
  if(this._vehicleHitAt.size>16)this._vehicleHitAt.delete(this._vehicleHitAt.keys().next().value);
  const amount=Math.max(0,Number(event.amount)||0),strength=cl(amount/40,0,1);
  this._play(.26,0,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.05,attack:.0008,gain:.2+.28*strength,type:'bandpass',freq:1400+800*strength,sweep:420,q:1.3});
   this._tone(t,out,nodes,{freq:92+64*strength,duration:.2,type:'triangle',gain:.07+.13*strength,end:42});
   // Occupant thud: the cabin hears the hit filtered through the hull.
   this._noise(t+.02,out,nodes,{duration:.16,gain:.08+.14*strength,type:'lowpass',freq:420,sweep:150,q:.8});
  },{send:.16*strength});
  return true;
 }
 // Respawn boot-up: a short rising system sweep for the local spawn. One voice.
 _spawnBoot(){
  this._play(.42,0,(t,out,nodes)=>{
   this._tone(t,out,nodes,{freq:120,duration:.3,type:'triangle',gain:.1,end:520});
   this._noise(t+.02,out,nodes,{duration:.24,gain:.15,type:'bandpass',freq:400,sweep:1800,q:.7,attack:.02});
   this._tone(t+.24,out,nodes,{freq:660,duration:.14,type:'sine',gain:.09,end:990});
  });
 }
 // The historical low-health heartbeat voice, kept bit-for-bit (duration .22)
 // so its envelope and duration pin are unchanged; the entry alert layers on a
 // separate token only on the was-low-health edge.
 _heartbeat(){
  this._play(.22,0,(t,out,nodes)=>{
   this._tone(t,out,nodes,{freq:54,duration:.07,type:'sine',gain:.13,end:32});
   this._tone(t+.1,out,nodes,{freq:46,duration:.09,type:'sine',gain:.15,end:26});
  });
 }
 // One-shot low-health entry warning.
 _lowHealthWarn(){
  this._play(.34,0,(t,out,nodes)=>{
   this._tone(t,out,nodes,{freq:392,duration:.12,type:'square',gain:.07,end:294});
   this._tone(t+.14,out,nodes,{freq:294,duration:.16,type:'square',gain:.06,end:196});
   this._noise(t,out,nodes,{duration:.3,gain:.08,type:'lowpass',freq:600,sweep:200,q:.6,attack:.02});
  });
 }
  event(e,player){if(!this.ctx||!e||!player)return;const local=this._isLocal(e,player),
   // Position normalizer: streams carry `from`/`pos`, while the sim's telegraph
   // and ordnance beats carry the raw world x/z. Without this an event with
   // only x/z resolves no position, `_falloff` returns 0 and the beat is silent
   // for every player — the enemy telegraph bug this pass fixes.
   pos=e.from??e.pos??(Number.isFinite(e.x)?{x:e.x,y:Number.isFinite(e.y)?e.y:0,z:e.z}:null),pan=this._panFor(pos,player);
  this._maybeMatchStart(e);
  this._musicEventState(e,local);
  this._announceHighValue(e,local);
  const latticeCue=latticeSoundCue(e,player,this._latticeAudioState);if(latticeCue){this._beat(latticeCue,0,1,.2);return;}
   // Traversal accents ride the shared synth/voice cap. A cocs device-use
   // keeps its lattice earcon above; these are the mechanical beats at the
   // cable and the portal, layered on the same event stream.
   if(e.type==='teleport'||e.type==='teleporter'){const vol=local?1:this._falloff(pos,player,36);if(vol>.02)this._teleport(pan,vol,local);return;}
   if(e.type==='zipline'){const from=e.from??pos,vol=local?1:this._falloff(from,player,30);if(vol>.03)this._ziplineStart(pan,vol);return;}
   if(e.type==='zipline-arrival'){const to=e.to??pos,vol=local?1:this._falloff(to,player,30);if(vol>.03)this._ziplineArrival(pan,vol);return;}
   if(e.type==='zipline-jump'){if(local)this._click(0,1,.05,1100);return;}
   if(e.type==='launcher'){const from=e.from??pos,vol=local?1:this._falloff(from,player,32);if(vol>.03)this._launcherStart(pan,vol);return;}
   if(e.type==='launcher-arrival'){const to=e.to??pos,vol=local?1:this._falloff(to,player,32);if(vol>.03)this._ziplineArrival(pan,vol);return;}
   if(e.type==='jump-pad'){const vol=local?1:this._falloff(pos,player,22);if(vol>.05)this._play(.24,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.24*vol,type:'lowpass',freq:700,sweep:180,q:.8});this._tone(t,out,nodes,{freq:150,duration:.2,type:'triangle',gain:.1*vol,end:420});});return;}
  if(e.type==='shot'||e.type==='vehicle-shot'||e.type==='launch'){const same=this.lastReport&&e.time!=null&&this.lastReport.time===e.time&&this.lastReport.actor===e.actor&&this.lastReport.weapon===e.weapon&&this.lastReport.type===e.type;this.lastReport=e;if(same)return;const vehicle=e.type==='vehicle-shot',vol=local?1:this._falloff(pos,player,vehicle?42:34)*(vehicle?.95:.9);if(vol>.01){if(vehicle)this._chaingun(pan,vol);else if(!this._altShot(e,local,pan,vol,player))this._gunshot(e,local,pan,vol,player);}return;}
  // Held alt-fire state flips: a short transform foley, deduped defensively so
  // a stream that repeats the current state still makes exactly one sound per
  // flip. The local actor is always voiced; remote actors fall off like the
  // other weapon foley.
  if(e.type==='alt-state'){
   // Keyed per actor and weapon: the sim silently resets `alt` on a weapon
   // switch, so pressing alt again on the new weapon must still deploy.
   const on=e.alt===true,actor=e.actor??e.actorId??null,key=actor==null?null:`${actor}:${Number.isInteger(e.weapon)?e.weapon:'?'}`,prev=key==null?undefined:this._altStates.get(key);
   if(prev===on)return;
   if(key!=null){if(this._altStates.size>=64)this._altStates.delete(this._altStates.keys().next().value);this._altStates.set(key,on);}
   const altVol=local?1:this._falloff(e.from??pos,player,22);
   if(altVol>.04)this._altState(pan,altVol,on,eventSeed(e));
   return;
  }
  if(e.type==='dryfire'){if(local)this._dryfire(pan);return;}
  if(e.type==='grenade'){const vol=local?1:this._falloff(pos,player,24);if(vol>.02)this._play(.18,pan,(t,out,nodes)=>{this._click(pan,vol,.06,1400);this._noise(t+.02,out,nodes,{duration:.12,gain:.22*vol,type:'bandpass',freq:800,sweep:300,q:.8});this._tone(t+.03,out,nodes,{freq:280,duration:.1,type:'triangle',gain:.08*vol,end:140});});return;}
  if(e.type==='explosion'){const vol=this._falloff(pos,player,42);if(vol>.02){const seed=eventSeed(e);if(local)this._duckMusic(.5,.6);this._play(.85,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.5,gain:.8*vol,type:'lowpass',freq:900,sweep:60,q:.8});this._noise(t,out,nodes,{duration:.05,attack:.001,gain:.5*vol,type:'highpass',freq:2400,sweep:600});this._tone(t,out,nodes,{freq:120,duration:.5,type:'sine',gain:.35*vol,end:34});this._tone(t,out,nodes,{freq:60,duration:.75,type:'sine',gain:.3*vol,end:28});this._debris(t,out,nodes,{vol,seed,cap:Math.round(vol*3.4)});},{send:.45*vol});}return;}
  if(e.type==='damage'){this.lastDamage=e;if(this._isLocal(e,player)){this._lastLocalDamageAt=Number.isFinite(this.ctx.currentTime)?this.ctx.currentTime:null;const hitPan=this._damagePan(e);this._play(e.shieldBreak?.24:.18,hitPan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.14,gain:.4,type:'lowpass',freq:700,sweep:200,q:.7});this._tone(t,out,nodes,{freq:150,duration:.14,type:'triangle',gain:.18,end:60});if(e.shieldBreak){this._noise(t,out,nodes,{duration:.2,gain:.42,type:'bandpass',freq:1800,sweep:300,q:1.2});this._tone(t+.02,out,nodes,{freq:260,duration:.18,type:'sawtooth',gain:.2,end:55});this._tone(t+.03,out,nodes,{freq:2100,duration:.16,type:'triangle',gain:.14,end:620});this._noise(t+.04,out,nodes,{duration:.12,gain:.2,type:'highpass',freq:3200,sweep:900,q:.8});}
   // Shield absorb: a shielded hit that did not break reads as a short glass
   // tick inside the same damage token, so one hit is still one voice.
   if(!e.shieldBreak&&Number(e.shield)>0){const shield=cl(Number(e.shield)/40,0,1);this._noise(t+.005,out,nodes,{duration:.05,attack:.0008,gain:.12+.1*shield,type:'bandpass',freq:2300+900*shield,sweep:1200,q:1.5});this._tone(t+.01,out,nodes,{freq:640+260*shield,duration:.09,type:'triangle',gain:.05+.03*shield,end:190});}
   if(e.critical||e.headshot)this._noise(t+.01,out,nodes,{duration:.03,gain:.2,type:'highpass',freq:2600,sweep:4200});});}else if(this._isScorer(e.source,player)&&e.amount>0){const stamp=this.ctx.currentTime;if(stamp-this.lastHit>=.045){this.lastHit=stamp;const crit=Boolean(e.critical||e.headshot||Number(e.amount)>=48);this._play(crit?.16:.12,0,(t,out,nodes)=>{if(crit){this._noise(t,out,nodes,{duration:.04,gain:.28,type:'highpass',freq:2200,sweep:3600});this._tone(t,out,nodes,{freq:1950,duration:.11,type:'triangle',gain:.16,end:2600});this._tone(t+.02,out,nodes,{freq:2900,duration:.09,type:'sine',gain:.11,end:3400});this._tone(t+.04,out,nodes,{freq:140,duration:.11,type:'sine',gain:.09,end:70});}else{this._noise(t,out,nodes,{duration:.05,gain:.26,type:'highpass',freq:1600,sweep:2600});this._tone(t,out,nodes,{freq:1250,duration:.07,type:'sine',gain:.11,end:1800});this._tone(t+.02,out,nodes,{freq:180,duration:.07,type:'sine',gain:.06,end:90});}if(e.shieldBreak){this._noise(t,out,nodes,{duration:.12,gain:.32,type:'bandpass',freq:2400,sweep:600,q:1.4});this._tone(t+.01,out,nodes,{freq:1600,duration:.1,type:'sawtooth',gain:.12,end:400});this._tone(t+.03,out,nodes,{freq:900,duration:.14,type:'triangle',gain:.1,end:1800});}if(crit)this._hitBell(t,out,nodes,{amount:e.amount,precision:Boolean(e.critical||e.headshot)});});} }return;}
  if(e.type==='death'){const vol=local?1:this._falloff(pos,player,32);if(vol>.02){const sound=deathSoundFor(e),seed=Number.isFinite(Number(e.seed))?Number(e.seed)>>>0:eventSeed(e),scorer=e.source??e.killer;this._play(DEATH_VOICE_DURATIONS[sound]??.6,pan,(t,out,nodes)=>{this._deathVoice(t,out,nodes,{sound,vol,local,seed});if(this._isScorer(scorer,player)&&scorer!==e.actor&&e.actor!==player.id)this._killConfirm(t,out,nodes,vol);},{send:.3*vol});}return;}
  if(e.type==='fall'){const vol=local?1:this._falloff(pos,player,26);if(vol>.03)this._play(.34,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.28,gain:.26*vol,type:'lowpass',freq:600,sweep:120,q:.7,attack:.03});this._tone(t,out,nodes,{freq:74,duration:.3,type:'sine',gain:.14*vol,end:30});});return;}
  if(e.type==='reload'){if(e.actor===player.id)this._reload(e.weapon??player.weapon,e.state,e.duration);return;}
  if(e.type==='melee'){if(e.actor===player.id)this._melee(e.weapon??player.weapon,e.hit!=null,e.surface??e.material);return;}
  if(e.type==='weapon-switch'){if(local)this._weaponSwitch(e.weapon??player.weapon,e.source);return;}
  if(e.type==='vehicle-damage'){this._vehicleDamage(e,player);return;}
  if(e.type==='vehicle-splatter'){const vol=local?1:this._falloff(pos,player,26);if(vol>.02)this._play(.2,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.5*vol,type:'lowpass',freq:600,sweep:180,q:.8});this._tone(t,out,nodes,{freq:95,duration:.16,type:'sine',gain:.2*vol,end:40});});return;}
  if(e.type==='vehicle-destroyed'){const vol=local?1:this._falloff(pos,player,42);if(vol>.02)this._play(.85,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.6,gain:.8*vol,type:'lowpass',freq:750,sweep:50,q:.85});this._tone(t,out,nodes,{freq:85,duration:.55,type:'sawtooth',gain:.28*vol,end:25});this._tone(t,out,nodes,{freq:45,duration:.75,type:'sine',gain:.3*vol,end:20});this._noise(t+.06,out,nodes,{duration:.35,gain:.35*vol,type:'bandpass',freq:1400,sweep:300,q:.7});this._debris(t+.08,out,nodes,{vol,seed:eventSeed(e),cap:Math.round(vol*4)});},{send:.42*vol});return;}
  if(e.type==='vehicle-enter'){if(local)this._click(0,1,.08,800);return;}
  if(e.type==='vehicle-exit'){if(local)this._click(0,1,.07,700);return;}
  if(e.type==='soccer-goal'){const vol=local?1:(pos?Math.max(.35,this._falloff(pos,player,60)):.85);if(vol>.05){this._play(.65,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:220,duration:.6,type:'sawtooth',gain:.16*vol,end:220});this._tone(t,out,nodes,{freq:330,duration:.6,type:'triangle',gain:.14*vol,end:330});this._noise(t,out,nodes,{duration:.45,gain:.25*vol,type:'bandpass',freq:850,sweep:420,q:.8});},{send:.3*vol});}return;}
  if(e.type==='race-coin'){if(local||this._falloff(pos,player,20)>.1){this._play(.12,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:988,duration:.08,type:'sine',gain:.08,end:1318});this._tone(t+.03,out,nodes,{freq:1318,duration:.09,type:'triangle',gain:.06,end:1760});});}return;}
  if(e.type==='race-box'){const vol=local?1:this._falloff(pos,player,24);if(vol>.05){this._play(.25,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:520,duration:.12,type:'sine',gain:.08*vol,end:780});this._tone(t+.06,out,nodes,{freq:780,duration:.15,type:'triangle',gain:.07*vol,end:1175});});}return;}
  if(e.type==='race-boost'){const vol=local?1:this._falloff(pos,player,28);if(vol>.05){this._play(.35,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.3,gain:.45*vol,type:'lowpass',freq:800,sweep:1800,q:.7});this._tone(t,out,nodes,{freq:180,duration:.25,type:'sawtooth',gain:.15*vol,end:420});});}return;}
  if(e.type==='race-item'){const vol=local?1:this._falloff(pos,player,28);if(vol>.05){this._play(.25,pan,(t,out,nodes)=>{if(e.item==='turbo'||e.item==='star'){this._noise(t,out,nodes,{duration:.22,gain:.4*vol,type:'bandpass',freq:1200,sweep:2400,q:.9});this._tone(t,out,nodes,{freq:240,duration:.2,type:'sawtooth',gain:.14*vol,end:580});}else if(e.item==='shield'){this._tone(t,out,nodes,{freq:440,duration:.24,type:'sine',gain:.12*vol,end:660});this._tone(t+.05,out,nodes,{freq:660,duration:.2,type:'triangle',gain:.08*vol,end:880});}else if(e.item==='pulse'||e.item==='triple'||e.item==='bolt'){this._noise(t,out,nodes,{duration:.15,gain:.3*vol,type:'highpass',freq:1800,sweep:3200});this._tone(t,out,nodes,{freq:720,duration:.18,type:'square',gain:.1*vol,end:1440});}else{this._noise(t,out,nodes,{duration:.18,gain:.35*vol,type:'lowpass',freq:600,sweep:120,q:.8});this._tone(t,out,nodes,{freq:140,duration:.15,type:'triangle',gain:.12*vol,end:50});}});}return;}
  if(e.type==='race-hazard-hit'){const vol=local?1:this._falloff(pos,player,26);if(vol>.05){this._play(.32,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.28,gain:.4*vol,type:'bandpass',freq:1400,sweep:400,q:.6});this._tone(t,out,nodes,{freq:340,duration:.25,type:'sawtooth',gain:.15*vol,end:80});});}return;}
  if(e.type==='race-lap'){if(local){this._play(.4,0,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:523,duration:.18,type:'triangle',gain:.09,end:659});this._tone(t+.1,out,nodes,{freq:659,duration:.22,type:'triangle',gain:.09,end:784});this._tone(t+.2,out,nodes,{freq:1046,duration:.25,type:'sine',gain:.08,end:1046});});}return;}
  // Enemy windup telegraphs. The sim stamps the unit `kind` onto the event and
  // carries the world x/z (normalized above), so every telegraph is audible and
  // each unit kind reads as its own motif; an unknown kind keeps the generic
  // fallback. One token per event.
  if(e.type==='enemy-telegraph'){const vol=local?1:this._falloff(pos,player,30);if(vol>.03)this._beat(TELEGRAPH_CUES[e.kind]||TELEGRAPH_CUES.generic,pan,vol,.22);return;}
  if(e.type==='race-finish'){if(local){this._play(.6,0,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:440,duration:.2,type:'triangle',gain:.1,end:554});this._tone(t+.12,out,nodes,{freq:554,duration:.2,type:'triangle',gain:.1,end:659});this._tone(t+.24,out,nodes,{freq:880,duration:.35,type:'sine',gain:.12,end:880});});}return;}
  // Weather/time onset cues: the sim emits these only when a script flips the
  // state, but a replay can repeat the current kind. The stored key makes the
  // cue an actual onset — the first report or a real change — never a repeat.
  if(e.type==='weather-change'){
   const kind=e.kind==null?null:String(e.kind);
   if(kind===this._weatherCueKind)return;
   this._weatherCueKind=kind;
   const vol=local?1:(pos?Math.max(.25,this._falloff(pos,player,40)):.9);
   this._beat(EVENT_CUES['weather-change'],pan,vol,.3);
   return;
  }
  if(e.type==='time-change'){
   const phase=e.phase==null?null:String(e.phase);
   if(phase===this._timeCuePhase)return;
   this._timeCuePhase=phase;
   this._beat(EVENT_CUES['time-change'],pan,local?1:.9,.3);
   return;
  }
  // Event-driven music: a capture/loss beat the running soundtrack can answer is
  // a harmonic response quantised to the next music step and owns the beat
  // outright. With music off (or the response queue full) the motif table below
  // keeps exactly its historical voice, so the two never double-layer.
  const harmonic=HARMONIC_RESPONSES[e.type];
  if(harmonic){
   // A replayed event id is swallowed: the beat was already owned by whichever
   // voice (music or motif) claimed it the first time.
   if(!this._claimMusicBeat(e.id,`harm:${harmonic}`))return;
   const vol=local?1:(pos?Math.max(.2,this._falloff(pos,player,48)):.9);
   if(this._musicResponse(harmonic,{vol}))return;
  }
  // Objective / pickup motifs. Flag and capture cues are deliberately audible
  // for every player (they are match beats); ordinary pickups stay local.
  if(e.type==='power'){if(!local)return;this._beat(POWER_CUES[e.harness]||objectiveCue('power'),pan,1,.25);if(this.announcer)this.announcerCue('power');return;}
  // Local spawn gets its own boot-up sweep instead of the objective blip.
  if(e.type==='spawn'){if(local)this._spawnBoot();return;}
  // Per-kind pickup identity: health/armor/ammo/weapon each get their own motif.
  if(e.type==='pickup'){if(local)this._beat(pickupCue(e.kind),pan,1,.25);return;}
  if(e.type==='powerup'||e.type.startsWith('flag')){if(!local&&e.type!=='flag-pickup'&&e.type!=='flag-drop'&&e.type!=='flag-return')return;this._beat(objectiveCue(e.type),pan,1,.25);return;}
  // KOTH/domination progress is quantized to 25% buckets plus contested/owner
  // flips keyed per zone; a repeated tick is silent.
  if(e.type==='zone-progress'){const cue=this._zoneProgress(e);if(!cue)return;const vol=local?1:(pos?Math.max(.2,this._falloff(pos,player,44)):.9);this._beat(cue,pan,vol,.24);return;}
  // Actor-specific utility beats only voice for the local player.
  if(e.type==='threat-ping'||e.type==='loadout-switch'){if(!local)return;this._beat(EVENT_CUES[e.type],pan,1,.25);return;}
  if(e.type==='capture'||EVENT_CUES[e.type]){const vol=local?1:(pos?Math.max(.2,this._falloff(pos,player,48)):.9);this._beat(EVENT_CUES[e.type]||objectiveCue('capture'),pan,vol,.3);return;}
  if(e.type.startsWith('zone')){const vol=local?1:(pos?Math.max(.2,this._falloff(pos,player,44)):.9);this._beat(objectiveCue('zone'),pan,vol,.24);return;}
  // Local ability/deployable foley and enemy ordnance, volume-shaped by distance.
  if(e.type==='dash'||e.type==='jam'||e.type==='feint'||e.type==='deployable'||e.type==='deployable-fire'||e.type==='deployable-expire'||e.type==='phalanx-shield'||e.type==='enemy-artillery'||e.type==='enemy-detonate'||e.type==='enemy-flank'){
   const vol=local?1:this._falloff(pos,player,28);if(vol>.03){
    if(e.type==='dash')this._play(.16,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.12,gain:.22*vol,type:'bandpass',freq:1200,sweep:2600,q:.8});this._tone(t,out,nodes,{freq:180,duration:.1,type:'triangle',gain:.06*vol,end:80});});
    else if(e.type==='feint'){this._play(.2,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.1,gain:.18*vol,type:'highpass',freq:2400,sweep:3600,q:.8});this._tone(t,out,nodes,{freq:660,duration:.16,type:'triangle',gain:.05*vol,end:220});});if(local&&this.announcer)this.announcerCue('feint');}
    else if(e.type==='jam')this._play(.3,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.24,gain:.3*vol,type:'bandpass',freq:2400,sweep:400,q:1.4});this._tone(t,out,nodes,{freq:420,duration:.22,type:'square',gain:.08*vol,end:120});});
    else if(e.type==='phalanx-shield')this._play(.3,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.2,gain:.28*vol,type:'bandpass',freq:1500,sweep:600,q:1.1});this._tone(t+.01,out,nodes,{freq:300,duration:.24,type:'triangle',gain:.1*vol,end:900});});
    else if(e.type==='enemy-artillery'||e.type==='enemy-detonate')this._play(.55,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.38,gain:.5*vol,type:'lowpass',freq:700,sweep:70,q:.8});this._tone(t,out,nodes,{freq:95,duration:.3,type:'sawtooth',gain:.18*vol,end:30});this._debris(t,out,nodes,{vol,seed:eventSeed(e),cap:3});},{send:.35*vol});
    else if(e.type==='enemy-flank')this._beat(EVENT_CUES['enemy-flank'],pan,vol,.25);
    else this._play(.2,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.14,gain:.24*vol,type:'bandpass',freq:1000,sweep:2200,q:.8});this._tone(t,out,nodes,{freq:220,duration:.12,type:'triangle',gain:.07*vol,end:440});});
   }return;
  }
  // Movement verbs (§3.4/§6.3): local-only foley keyed to the movement module's
  // shared event vocabulary, plus an opt-in announcer motif per verb. A known
  // verb voices its own foley (`handled`); every other event — unknown verb,
  // missing verb field or an unhandled type/verb pair — falls through to the
  // generic per-type chain below, which stays bit-for-bit the pre-verb voice.
  if(MOVEMENT_EVENTS.has(e.type)){
   if(!local)return;
   const verb=typeof e.verb==='string'&&e.verb.length?e.verb:null;
   const handled=Boolean(verb&&MOVEMENT_VERBS.has(verb)&&this._moveVerb(verb,e,pan));
   if(handled){/* the per-verb voice already played */}
   else if(e.type==='move-start')this._play(.22,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.24,type:'bandpass',freq:900,sweep:2600,q:.7});this._tone(t,out,nodes,{freq:150,duration:.14,type:'triangle',gain:.05,end:320});});
   else if(e.type==='windup-start'||e.type==='charge-start'){const duration=Math.min(1,Math.max(.1,Number(e.duration)||.3));this._play(duration+.1,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:180,duration,type:'sawtooth',gain:.05,end:520});this._noise(t,out,nodes,{duration:.2,gain:.12,type:'bandpass',freq:600,sweep:1800,q:.8});});}
   else if(e.type==='slam-launch')this._play(.24,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.18,gain:.28,type:'lowpass',freq:700,sweep:220,q:.7});this._tone(t,out,nodes,{freq:120,duration:.2,type:'triangle',gain:.1,end:420});});
   else if(e.type==='slam-impact')this._play(.42,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.3,gain:.5,type:'lowpass',freq:520,sweep:90,q:.8});this._tone(t,out,nodes,{freq:70,duration:.32,type:'sine',gain:.22,end:28});this._debris(t,out,nodes,{vol:1,seed:eventSeed(e),cap:3});});
   else if(e.type==='grapple-hook')this._play(.18,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.08,gain:.3,type:'bandpass',freq:1800,sweep:900,q:1.4});this._tone(t,out,nodes,{freq:260,duration:.14,type:'triangle',gain:.09,end:520});});
   else if(e.type==='rope-place')this._play(.3,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.24,type:'bandpass',freq:1200,sweep:2600,q:.9});this._tone(t,out,nodes,{freq:520,duration:.22,type:'sine',gain:.1,end:780});});
   else if(e.type==='fuel-empty'||e.type==='no-lift'||e.type==='move-blocked')this._play(.16,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:220,duration:.1,type:'square',gain:.05,end:150});this._noise(t,out,nodes,{duration:.08,gain:.1,type:'lowpass',freq:700,sweep:300,q:.7});});
   else if(e.type==='landing-recovery')this._play(.18,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.14,gain:.24,type:'lowpass',freq:500,sweep:150,q:.7,attack:.01});this._tone(t,out,nodes,{freq:90,duration:.16,type:'sine',gain:.12,end:36});});
   else this._play(.14,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.1,gain:.14,type:'bandpass',freq:1100,sweep:420,q:.9});this._tone(t,out,nodes,{freq:200,duration:.1,type:'triangle',gain:.04,end:110});});
   if(this.announcer&&(e.type==='move-start'||e.type==='slam-impact'||e.type==='rope-place'))this.announcerCue(verb&&ANNOUNCE_CUES[verb]?verb:(e.type==='move-start'?'move-start':e.type));
   return;
  }
 }
  // Per-verb movement foley. Each handler returns true only when it voiced the
  // event; returning false lets the generic per-type chain keep the pre-verb
  // voice, so a known verb with an unhandled event type is still covered.
  _moveVerb(verb,e,pan){
   switch(verb){
    case 'air-dash':return e.type==='move-start'?this._dashWhoosh(pan):false;
    case 'double-jump':return e.type==='move-start'?this._jumpBounce(pan):false;
    case 'super-jump':return this._superJumpFoley(e.type,pan,e);
    case 'hover-jets':return this._hoverFoley(e.type,pan);
    case 'brace-slam':return this._slamFoley(e.type,pan,e);
    case 'safety-glide':return this._glideFoley(e.type,pan);
    case 'grapple':return this._grappleFoley(e.type,pan);
    case 'blink-step':return this._blinkFoley(e.type,pan,e);
    case 'deployable-rope':return this._ropeFoley(e.type,pan);
    default:return false;
   }
  }
  _dashWhoosh(pan){
   this._play(.26,pan,(t,out,nodes)=>{
    this._noise(t,out,nodes,{duration:.2,gain:.24,type:'bandpass',freq:420,sweep:2700,q:.75,attack:.006});
    this._noise(t+.02,out,nodes,{duration:.1,gain:.1,type:'highpass',freq:1200,sweep:3200,q:.6});
    this._tone(t,out,nodes,{freq:205,duration:.16,type:'triangle',gain:.06,end:70});
   });
   return true;
  }
  _jumpBounce(pan){
   this._play(.22,pan,(t,out,nodes)=>{
    this._noise(t,out,nodes,{duration:.1,gain:.2,type:'lowpass',freq:540,sweep:220,q:.8});
    this._tone(t,out,nodes,{freq:138,duration:.16,type:'triangle',gain:.1,end:460});
    this._tone(t+.05,out,nodes,{freq:276,duration:.1,type:'sine',gain:.06,end:620});
   });
   return true;
  }
  _superJumpFoley(type,pan,e){
   if(type==='charge-start'){
    const duration=Math.min(1,Math.max(.1,Number(e.duration)||.3));
    this._play(duration+.12,pan,(t,out,nodes)=>{
     this._tone(t,out,nodes,{freq:160,duration,type:'sawtooth',gain:.055,end:620});
     this._noise(t,out,nodes,{duration:duration*.85,gain:.1,type:'bandpass',freq:480,sweep:1500,q:.9,attack:.02});
     this._tone(t+duration*.9,out,nodes,{freq:430,duration:.07,type:'triangle',gain:.05,end:540});
    });
    return true;
   }
   if(type==='move-start'){
    // The impulse and the charge release land in the same frame: this is the
    // launch thump, the release note below is its short upper snap.
    this._play(.3,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.22,gain:.28,type:'lowpass',freq:640,sweep:140,q:.75,attack:.004});
     this._tone(t,out,nodes,{freq:108,duration:.26,type:'sawtooth',gain:.13,end:430});
     this._tone(t+.02,out,nodes,{freq:255,duration:.16,type:'triangle',gain:.07,end:760});
    });
    return true;
   }
   if(type==='charge-release'){
    this._play(.18,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.1,gain:.14,type:'highpass',freq:1500,sweep:4200,q:.7});
     this._tone(t,out,nodes,{freq:720,duration:.1,type:'triangle',gain:.05,end:1180});
    });
    return true;
   }
   return false;
  }
  _hoverFoley(type,pan){
   if(type==='move-start'){
    // Ignition plus a short loop-tick trill so the held jets read as running.
    this._play(.34,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.26,gain:.13,type:'bandpass',freq:680,sweep:1400,q:.8,attack:.01});
     this._tone(t,out,nodes,{freq:175,duration:.22,type:'sawtooth',gain:.055,end:270});
     for(let i=0;i<3;i++)this._tone(t+.06+i*.09,out,nodes,{freq:880+i*70,duration:.04,type:'square',gain:.028,end:690+i*50});
    });
    return true;
   }
   if(type==='move-end'){
    this._play(.2,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.14,gain:.09,type:'lowpass',freq:900,sweep:320,q:.8});
     this._tone(t,out,nodes,{freq:235,duration:.12,type:'triangle',gain:.045,end:110});
    });
    return true;
   }
   return false;
  }
  _slamFoley(type,pan,e){
   if(type==='windup-start'){
    const duration=Math.min(.6,Math.max(.08,Number(e.duration)||.3));
    this._play(duration+.1,pan,(t,out,nodes)=>{
     this._tone(t,out,nodes,{freq:145,duration,type:'sawtooth',gain:.06,end:560});
     this._noise(t,out,nodes,{duration:duration*.75,gain:.11,type:'bandpass',freq:480,sweep:1500,q:.9,attack:.02});
     this._tone(t+duration*.92,out,nodes,{freq:320,duration:.06,type:'square',gain:.05,end:175});
    });
    return true;
   }
   if(type==='slam-launch'){
    this._play(.26,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.2,gain:.3,type:'lowpass',freq:760,sweep:200,q:.75});
     this._tone(t,out,nodes,{freq:118,duration:.22,type:'triangle',gain:.11,end:460});
    });
    return true;
   }
   if(type==='slam-impact'){
    this._play(.4,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.3,gain:.44,type:'lowpass',freq:560,sweep:80,q:.85});
     this._noise(t,out,nodes,{duration:.06,gain:.18,type:'highpass',freq:2200,sweep:700,q:.9});
     this._tone(t,out,nodes,{freq:64,duration:.34,type:'sine',gain:.2,end:26});
     this._debris(t,out,nodes,{vol:1,seed:eventSeed(e),cap:3});
    });
    return true;
   }
   return false;
  }
  _glideFoley(type,pan){
   if(type==='move-start'){
    this._play(.36,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.34,gain:.16,type:'bandpass',freq:1400,sweep:520,q:.5,attack:.05});
     this._noise(t+.05,out,nodes,{duration:.24,gain:.09,type:'highpass',freq:2600,sweep:1200,q:.6,attack:.03});
     this._tone(t,out,nodes,{freq:330,duration:.2,type:'sine',gain:.035,end:240});
    });
    return true;
   }
   if(type==='move-end'){
    this._play(.26,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.24,gain:.1,type:'bandpass',freq:900,sweep:420,q:.6,attack:.03});
     this._tone(t,out,nodes,{freq:290,duration:.14,type:'sine',gain:.03,end:180});
    });
    return true;
   }
   return false;
  }
  _grappleFoley(type,pan){
   if(type==='grapple-hook'){
    // Hook bite plus three reel ticks on the line.
    this._play(.34,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.07,gain:.28,type:'bandpass',freq:1900,sweep:900,q:1.5});
     this._tone(t,out,nodes,{freq:250,duration:.12,type:'triangle',gain:.09,end:520});
     for(let i=0;i<3;i++)this._tone(t+.1+i*.07,out,nodes,{freq:640+i*160,duration:.035,type:'square',gain:.04,end:520+i*120});
    });
    return true;
   }
   if(type==='move-start'){
    this._play(.22,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.16,gain:.12,type:'bandpass',freq:1000,sweep:2600,q:.8,attack:.01});
     this._tone(t,out,nodes,{freq:190,duration:.14,type:'triangle',gain:.05,end:420});
    });
    return true;
   }
   if(type==='grapple-release'){
    this._play(.2,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.12,gain:.16,type:'highpass',freq:2400,sweep:900,q:.9});
     this._tone(t,out,nodes,{freq:520,duration:.1,type:'triangle',gain:.06,end:180});
    });
    return true;
   }
   return false;
  }
  _blinkFoley(type,pan,e){
   if(type==='windup-start'){
    const duration=Math.min(.6,Math.max(.05,Number(e.duration)||.2));
    this._play(duration+.12,pan,(t,out,nodes)=>{
     this._tone(t,out,nodes,{freq:620,duration,type:'sine',gain:.06,end:1480});
     this._noise(t,out,nodes,{duration:duration*.8,gain:.09,type:'highpass',freq:1400,sweep:3600,q:.7,attack:.01});
    });
    return true;
   }
   if(type==='move-start'){
    this._play(.24,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.16,gain:.2,type:'bandpass',freq:2400,sweep:700,q:1.1});
     this._tone(t,out,nodes,{freq:1320,duration:.12,type:'sine',gain:.075,end:420});
     this._tone(t+.01,out,nodes,{freq:660,duration:.1,type:'triangle',gain:.05,end:220});
    });
    return true;
   }
   if(type==='windup-end'){
    this._play(.16,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.1,gain:.12,type:'highpass',freq:3200,sweep:900,q:.8});
     this._tone(t,out,nodes,{freq:1180,duration:.09,type:'sine',gain:.05,end:360});
    });
    return true;
   }
   return false;
  }
  _ropeFoley(type,pan){
   if(type==='rope-place'){
    // Anchor thunk, line pay-out and three reel ticks.
    this._play(.36,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.12,gain:.3,type:'lowpass',freq:700,sweep:220,q:.85,attack:.003});
     this._tone(t,out,nodes,{freq:120,duration:.16,type:'triangle',gain:.12,end:64});
     this._tone(t+.03,out,nodes,{freq:520,duration:.16,type:'sine',gain:.07,end:880});
     for(let i=0;i<3;i++)this._tone(t+.1+i*.07,out,nodes,{freq:760+i*120,duration:.03,type:'square',gain:.035,end:600+i*90});
    });
    return true;
   }
   if(type==='move-start'){
    this._play(.2,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.14,gain:.14,type:'bandpass',freq:1100,sweep:2500,q:.8,attack:.01});
     this._tone(t,out,nodes,{freq:420,duration:.12,type:'triangle',gain:.05,end:720});
    });
    return true;
   }
   if(type==='rope-expire'){
    this._play(.22,pan,(t,out,nodes)=>{
     this._noise(t,out,nodes,{duration:.16,gain:.1,type:'highpass',freq:2000,sweep:600,q:.8});
     this._tone(t,out,nodes,{freq:880,duration:.1,type:'sine',gain:.05,end:300});
    });
    return true;
   }
   return false;
  }
  update(player,vehicles=[],dt=0,opts=null){if(!this.ctx||!player)return;if(this.muted){this._engine(0,false);this._bed(false);return;}if(!this.bed&&this.ambientBed!==false)this._bed(true);
  // Optional host extras: the live match snapshot drives the FIGHT sting, the
  // race/soccer countdown and the final-ten warning; explicit weather/biome
  // route the ambience bed. Absent opts keep every existing caller unchanged.
  if(opts){if(opts.match)this.setMatchState(opts.match);if(opts.race)this.countdown(opts.race);if(opts.soccer)this.countdown(opts.soccer);if('weather' in opts)this.setWeather(opts.weather);if('biome' in opts)this.setArenaBiome(opts.biome);if('arena' in opts)this.setArenaBiome(opts.arena);}
  const surface=this._surfaceFor(player,opts);
  if(player.grounded&&this.wasGrounded===false&&player.vehicleId==null){const impact=cl(Math.abs(this.lastVy||0)/13,0,1);if(impact>.12)this._landing(impact,player.weapon,surface);}
  else if(!player.grounded&&this.wasGrounded===true&&player.vehicleId==null&&player.health>0)this._jump(surface,player.weapon);
  this.wasGrounded=player.grounded;this.lastVy=player.vy||0;
  const speed=Math.hypot(player.vx||0,player.vz||0);
  if(player.health>0&&player.vehicleId==null&&player.grounded===true){
    if(player.sliding&&speed>2){
      if(!this.wasSliding){
        this.footPhase=0;
        this._slide(speed,surface);
      }else{
        this.footPhase=(this.footPhase||0)+dt*8;
        if(this.footPhase>=1){this.footPhase-=1;this._slide(speed,surface);}
      }
    }else if(speed>1.4){
      this.footPhase=(this.footPhase||0)+dt*speed*.62;
      if(this.footPhase>=1){this.footPhase-=1;this._footstep(speed,player.weapon,surface);}
    }else this.footPhase=0;
  }else this.footPhase=0;
  this.wasSliding=Boolean(player.sliding&&player.grounded&&speed>2&&player.health>0&&player.vehicleId==null);
  const isLowHealth=Boolean(player.health>0&&player.health<=(player.maxHealth??100)*.28&&player.vehicleId==null&&!this.muted);
  if(isLowHealth){
    const entry=!this.wasLowHealth;
    // The entry edge opens the soundtrack's danger layer (state only), scaled by
    // how far under the threshold the player fell; recovery releases exactly the
    // contribution this edge added so any other tension source survives.
    if(entry){
      const depth=cl(player.health/((player.maxHealth??100)*.28),0,1);
      this._lowHealthTension=cl(.45+.55*(1-depth),0,1);
      this.setTension(cl((this.tension||0)+this._lowHealthTension,0,1));
    }
    this.heartbeatTimer=(this.heartbeatTimer||0)+dt;
    if(entry||this.heartbeatTimer>=1.15){
      this.heartbeatTimer=0;
      this._heartbeat();
      // The entry frame adds the one-shot alert after the unchanged heartbeat
      // envelope, so the pinned .22 s heartbeat voice keeps its duration and the
      // alert never shifts the pinned index.
      if(entry)this._lowHealthWarn();
    }
  }else{
    this.heartbeatTimer=0;
    if(this._lowHealthTension){
      const contribution=this._lowHealthTension;
      this._lowHealthTension=0;
      this.setTension(cl((this.tension||0)-contribution,0,1));
    }
  }
  this.wasLowHealth=isLowHealth;
  // Health-driven master tone: full health is neutral, falling health eases the
  // cutoff/level down. No-op without the optional master stage.
  const healthFraction=Number.isFinite(player.health)&&Number.isFinite(player.maxHealth)&&player.maxHealth>0?cl(player.health/player.maxHealth,0,1):1;
  this._applyHealthMix(healthFraction);
  const vehicle=(vehicles||[]).find(v=>v.id===player.vehicleId||v.driver===player.id),vx=vehicle?(vehicle.vx??vehicle.velocity?.x??0):0,vz=vehicle?(vehicle.vz??vehicle.velocity?.z??0):0,boosting=Boolean(vehicle&&(vehicle.boosting===true||(vehicle.boostCooldown??0)>0||(vehicle.effects?.turbo>0)));
  // Snapshot vehicle kind selects the engine timbre; the same snapshot's lateral
  // velocity (relative to the chassis heading) drives the Puma skid loop.
  const engineKind=vehicle?(vehicle.kind??vehicle.config?.kind??null):null;
  const vyaw=vehicle&&Number.isFinite(vehicle.yaw)?vehicle.yaw:(vehicle&&Number.isFinite(vehicle.heading)?vehicle.heading:0);
  const lateral=vehicle?vx*Math.cos(vyaw)-vz*Math.sin(vyaw):0;
  this._engine(vehicle?Math.hypot(vx,vz):0,Boolean(vehicle),boosting,engineKind);
  this._skidLoop(Boolean(vehicle&&engineKind==='puma'&&Math.abs(lateral)>1.1),Math.abs(lateral),engineKind);
  const ride=player.zipRide;
  this._zipLoop(Boolean(ride&&player.vehicleId==null&&player.health>0),ride?Math.max(1,Number(ride.speed)||9):9);}
 _engine(speed,active,boosting=false,kind=null){if(!this.ctx)return;if(active&&!this.muted){const voice=engineVoice(kind,speed,boosting),profile=voice.profile;if(!this.engine){const osc=this.ctx.createOscillator(),sub=this.ctx.createOscillator(),boost=this.ctx.createOscillator(),bg=this.ctx.createGain(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();osc.type=profile.osc;sub.type=profile.sub;boost.type=profile.osc;f.type='lowpass';f.frequency.value=700;g.gain.value=.0001;bg.gain.value=.0001;osc.connect(f);sub.connect(f);boost.connect(bg);bg.connect(f);f.connect(g);g.connect(this.effectsBus||this.master);osc.start();sub.start();boost.start();this.engine={osc,sub,boost,bg,f,g,kind:voice.kind};}
   if(this.engine.kind!==voice.kind){this.engine.kind=voice.kind;try{this.engine.osc.type=profile.osc;this.engine.boost.type=profile.osc;this.engine.sub.type=profile.sub;}catch{}}
   const t=this.ctx.currentTime;this.engine.osc.frequency.setTargetAtTime(voice.oscFreq,t,.1);this.engine.sub.frequency.setTargetAtTime(voice.subFreq,t,.1);this.engine.g.gain.setTargetAtTime(voice.gain,t,.12);this.engine.f.frequency.setTargetAtTime(voice.filterFreq,t,.15);
   // Boost layer: a second overtone that only opens while boosting, inside the
   // same long-lived engine node set (no extra node per frame).
   this.engine.boost.frequency.setTargetAtTime(voice.oscFreq*2,t,.1);this.engine.bg.gain.setTargetAtTime(boosting?voice.gain*.55:.0001,t,.12);
  }else if(this.engine){const {osc,sub,boost,g}=this.engine,t=this.ctx.currentTime;g.gain.setTargetAtTime(.0001,t,.08);this.engine=null;setTimeout(()=>{try{osc.stop();sub.stop();boost.stop();}catch{}},300);}}
 _zipLoop(active,speed=9){if(!this.ctx)return;const on=active===true&&!this.muted;if(on){if(!this.zipLoop){const osc=this.ctx.createOscillator(),hum=this.ctx.createOscillator(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();osc.type='sawtooth';hum.type='triangle';f.type='bandpass';f.frequency.value=1100;f.Q.value=.7;g.gain.value=.0001;osc.connect(f);hum.connect(f);f.connect(g);g.connect(this.effectsBus||this.master);osc.start();hum.start();this.zipLoop={osc,hum,f,g};}const t=this.ctx.currentTime,s=cl(speed/14,0,1);this.zipLoop.osc.frequency.setTargetAtTime(120+s*90,t,.15);this.zipLoop.hum.frequency.setTargetAtTime(60+s*45,t,.15);this.zipLoop.f.frequency.setTargetAtTime(900+s*800,t,.15);this.zipLoop.g.gain.setTargetAtTime(.012+s*.02,t,.12);}else if(this.zipLoop){const {osc,hum,g}=this.zipLoop,t=this.ctx.currentTime;g.gain.setTargetAtTime(.0001,t,.08);this.zipLoop=null;setTimeout(()=>{try{osc.stop();hum.stop();}catch{}},300);}}
 // Puma skid loop: the same long-lived eased-node pattern as the zip loop, but
 // driven by lateral slip instead of ride speed. It never spends a `_play`
 // token per frame; the caller flips `active` and the loop eases in/out. Only
 // chassis marked `skid` in ENGINE_PROFILES build it, so a Titan/Scout produces
 // no skid nodes at all.
 _skidLoop(active,slip=0,kind=null){
  if(!this.ctx)return false;
  const profile=ENGINE_PROFILES[kind]||ENGINE_PROFILES.default;
  const on=active===true&&profile.skid===true&&!this.muted;
  if(on){
   if(!this.skidLoop){
    const osc=this.ctx.createOscillator(),hum=this.ctx.createOscillator(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    osc.type='sawtooth';hum.type='triangle';f.type='bandpass';f.frequency.value=1800;f.Q.value=2.2;g.gain.value=.0001;
    osc.connect(f);hum.connect(f);f.connect(g);g.connect(this.effectsBus||this.master);osc.start();hum.start();this.skidLoop={osc,hum,f,g};
   }
   const t=this.ctx.currentTime,s=cl(Number(slip)||0,0,14)/14;
   this.skidLoop.osc.frequency.setTargetAtTime(320+s*520,t,.12);
   this.skidLoop.hum.frequency.setTargetAtTime(90+s*120,t,.12);
   this.skidLoop.f.frequency.setTargetAtTime(900+s*2200,t,.12);
   this.skidLoop.g.gain.setTargetAtTime(.006+s*.028,t,.1);
   return true;
  }
  if(this.skidLoop){
   const {osc,hum,g}=this.skidLoop,t=this.ctx.currentTime;
   g.gain.setTargetAtTime(.0001,t,.08);this.skidLoop=null;
   setTimeout(()=>{try{osc.stop();hum.stop();}catch{}},300);
  }
  return false;
 }
 // Teleporter charge/whoosh/arrival shimmer. One voice token per event.
 _teleport(pan,vol,local){this._play(.52,pan,(t,out,nodes)=>{
  this._tone(t,out,nodes,{freq:150,duration:.22,type:'sawtooth',gain:.1*vol,end:720});
  this._noise(t+.04,out,nodes,{duration:.3,gain:.34*vol,type:'bandpass',freq:600,sweep:2600,q:.9,attack:.005});
  this._noise(t+.16,out,nodes,{duration:.16,gain:.2*vol,type:'highpass',freq:1800,sweep:4200});
  this._tone(t+.2,out,nodes,{freq:880,duration:.22,type:'triangle',gain:.11*vol,end:1320});
  this._tone(t+.24,out,nodes,{freq:1760,duration:.18,type:'sine',gain:.05*vol,end:1320});
  if(local)this._tone(t+.02,out,nodes,{freq:60,duration:.3,type:'sine',gain:.12,end:32});
 },{send:.3*vol});}
 // Cable start: a ratchet clip plus the handle grab. Arrival: brake thump + chime.
 _ziplineStart(pan,vol){this._play(.28,pan,(t,out,nodes)=>{
  this._click(pan,vol,.07,1500);
  this._noise(t+.02,out,nodes,{duration:.16,gain:.22*vol,type:'highpass',freq:2200,sweep:700});
  this._tone(t+.05,out,nodes,{freq:320,duration:.16,type:'triangle',gain:.08*vol,end:180});
 });}
 _ziplineArrival(pan,vol){this._play(.34,pan,(t,out,nodes)=>{
  this._noise(t,out,nodes,{duration:.2,gain:.3*vol,type:'lowpass',freq:900,sweep:220,q:.8});
  this._tone(t,out,nodes,{freq:140,duration:.2,type:'sine',gain:.12*vol,end:70});
  this._tone(t+.04,out,nodes,{freq:660,duration:.2,type:'triangle',gain:.08*vol,end:990});
 },{send:.24*vol});}
 // Launcher: a rising pneumatic whoosh under the ballistic arc. Arrival reuses
 // the cable-brake thump so every traversal landing shares one accent.
 _launcherStart(pan,vol){this._play(.42,pan,(t,out,nodes)=>{
  this._noise(t,out,nodes,{duration:.34,gain:.4*vol,type:'bandpass',freq:500,sweep:2400,q:.8,attack:.004});
  this._tone(t,out,nodes,{freq:120,duration:.3,type:'sawtooth',gain:.14*vol,end:520});
  this._tone(t+.04,out,nodes,{freq:240,duration:.24,type:'triangle',gain:.08*vol,end:660});
 },{send:.3*vol});}
 dispose(){if(this._stingDuckTimer){clearTimeout(this._stingDuckTimer);this._stingDuckTimer=null;}if(this._musicDuckTimer){clearTimeout(this._musicDuckTimer);this._musicDuckTimer=null;}this._musicDuck=0;this.killcam=false;this.spectating=false;try{this.musicEngine?.dispose();}catch{}this.musicEngine=null;this._musicBeats.clear();try{this.mothAudio?.dispose?.();}catch{}this.mothAudio=null;if(this.engine){try{this.engine.osc.stop();this.engine.sub.stop();this.engine.boost?.stop();}catch{}this.engine=null;}if(this.zipLoop){try{this.zipLoop.osc.stop();this.zipLoop.hum.stop();}catch{}this.zipLoop=null;}if(this.skidLoop){try{this.skidLoop.osc.stop();this.skidLoop.hum.stop();}catch{}this.skidLoop=null;}if(this.bed){for(const node of Object.values(this.bed)){if(node&&typeof node.stop==='function')try{node.stop();}catch{}if(node&&typeof node.disconnect==='function')try{node.disconnect();}catch{}}this.bed=null;}for(const token of this.voices){clearTimeout(token.timer);for(const n of token.nodes){try{n.disconnect();}catch{}}}this.voices.clear();this._announceAt?.clear?.();this._altStates?.clear?.();this.lastSting=null;
 // The sampled announcer pack is dropped with the graph; decoded takes are
 // re-fetched on the next start and an in-flight decode cannot latch.
 this.announcerPack=null;this._announcerPackPromise=null;this._announcerVoiceUntil=0;
 // Release the precipitation presence, the pending mag-in timers and every
 // bounded edge-state map so a disposed engine cannot retain a timer or a zone.
 if(this.precip){for(const node of Object.values(this.precip)){if(node&&typeof node.stop==='function')try{node.stop();}catch{}if(node&&typeof node.disconnect==='function')try{node.disconnect();}catch{}}this.precip=null;}
 for(const pending of this._reloadPending.values())clearTimeout(pending.timer);
 this._reloadPending.clear();this._zoneAudio.clear();this._vehicleHitAt.clear();this._latticeAudioState?.hq?.clear?.();this._motifBeforeOutcome=null;this._lastLocalDamageAt=null;
 if(this.effectsGlue){for(const node of this.effectsGlue){try{node.disconnect();}catch{}}this.effectsGlue=null;}
 if(this.space){for(const node of Object.values(this.space)){try{node.disconnect();}catch{}}this.space=null;}
 for(const bus of [this.effectsBus,this.ambienceBus,this.musicBus,this.master,this.masterFilter,this.mixGain,this.muteGain]){try{bus?.disconnect();}catch{}}this.effectsBus=null;this.ambienceBus=null;this.musicBus=null;this.master=null;this.masterFilter=null;this.mixGain=null;this.muteGain=null;this._mixCutoff=20000;this._mixLevel=1;this.healthMix=1;this._shellAt=null;this._weatherCueKind=null;this._timeCuePhase=null;this._announceCadence=null;this.ctx?.close();this.ctx=null;this.status='off';}
}
